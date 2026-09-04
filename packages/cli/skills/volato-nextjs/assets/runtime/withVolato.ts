/**
 * `withVolato(nextConfig, options)` — wraps a Next.js config to:
 *
 *   1. Force-enable production browser and server source maps so real stacks
 *      can be symbolicated.
 *   2. Upload every `.js.map` under the build output through Webpack's
 *      `afterEmit` hook on Next.js 15, or Next.js 16's native
 *      `compiler.runAfterProductionCompile` lifecycle hook.
 *   3. Optionally delete browser `.map` files from the publicly served output
 *      so they don't ship to end users (`hideSourceMaps: true`). Server maps
 *      stay private in the build because Next still needs them while creating
 *      `output: "standalone"`.
 *
 * Server-side only: this module imports `node:fs` / `node:path` and is
 * meant to live in `next.config.{js,ts}`. Never import it from
 * client-side code or middleware.
 */

import { execSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { readFile, unlink } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { dsnToIngestUrl, parseDSN, projectFramePath } from "./protocol";
import { detectRelease } from "./internal/release";

export type WithVolatoOptions = {
  /**
   * Next.js major detected by the Volato installer. Next.js 16 uses the
   * bundler-neutral production compiler hook; earlier versions keep the
   * Webpack adapter. Defaults to 15 for recipes generated before this option
   * existed.
   */
  nextMajor?: number;
  /**
   * DSN used to derive the ingest origin. Defaults to
   * `process.env.NEXT_PUBLIC_VOLATO_DSN`. The DSN is **not** used as
   * auth on the upload path — the ingest route rejects DSN-bearing
   * write requests by design. Only its host portion matters here.
   */
  dsn?: string;
  /**
   * Advanced override for the build identifier attached to maps and events.
   * Normally Volato derives the current Git commit automatically, so users do
   * not need to configure or publish a release.
   */
  release?: string;
  /** Git commit containing this build. Auto-detected when `.git` is present. */
  commitSha?: string;
  /**
   * Delete browser `.map` files from `.next/static` after a successful upload
   * so they aren't served to end users. Server maps are retained for Next's
   * standalone assembly and are not publicly served. Default `true`.
   */
  hideSourceMaps?: boolean;
  /**
   * Skip the upload entirely (still emits maps). Useful for local dev
   * loops where you don't want every `next build` to hit the network.
   * Default `false`.
   */
  disableUpload?: boolean;
  /**
   * Override the upload endpoint. Defaults to the ingest origin
   * derived from the DSN.
   */
  uploadUrl?: string;
};

// Webpack's persistent build cache lives under `cache/` and is full of
// `.map` files from previous compilations that are not part of the
// served bundle. Walking them would upload thousands of stale maps
// every build.
const SKIP_DIRS = new Set(["cache", ".cache", "dev", "node_modules"]);

const UPLOAD_CONCURRENCY = 8;
// Backoff sequence for transient failures (network / 5xx). 4xx errors
// indicate a misconfiguration the user must see, so they're surfaced
// immediately without retry.
const RETRY_DELAYS_MS = [200, 800, 3200] as const;
const REPOSITORY_PREFIX_FIELD = "x_volato_repository_prefix";

function* walkJsMapFiles(root: string): Iterable<string> {
  let entries: string[];
  try {
    entries = readdirSync(root);
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = join(root, entry);
    let s;
    try {
      s = statSync(full);
    } catch {
      continue;
    }
    if (s.isDirectory()) {
      if (SKIP_DIRS.has(entry)) continue;
      yield* walkJsMapFiles(full);
    } else if (s.isFile() && full.endsWith(".js.map")) {
      yield full;
    }
  }
}

function* walkJavaScriptFiles(root: string): Iterable<string> {
  let entries: string[];
  try {
    entries = readdirSync(root);
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = join(root, entry);
    let s;
    try {
      s = statSync(full);
    } catch {
      continue;
    }
    if (s.isDirectory()) {
      if (SKIP_DIRS.has(entry)) continue;
      yield* walkJavaScriptFiles(full);
    } else if (s.isFile() && /\.[cm]?js$/.test(full)) {
      yield full;
    }
  }
}

type SourceMapUpload = {
  mapPath: string;
  jsRelative: string;
};

function referencedSourceMap(jsPath: string, source: string): string | null {
  const pattern =
    /(?:\/\/[#@]\s*sourceMappingURL=([^\s]+)|\/\*[#@]\s*sourceMappingURL=([^*\s]+)\s*\*\/)/g;
  let reference: string | undefined;
  for (const match of source.matchAll(pattern)) {
    reference = match[1] ?? match[2] ?? reference;
  }
  if (
    !reference ||
    reference.startsWith("/") ||
    /^[a-zA-Z][a-zA-Z+.-]*:/.test(reference)
  ) {
    return null;
  }
  try {
    return resolve(
      dirname(jsPath),
      decodeURIComponent(reference.replace(/[?#].*$/, "")),
    );
  } catch {
    return null;
  }
}

function isPublicBrowserMap(outputRoot: string, mapPath: string): boolean {
  const outputRelative = relative(outputRoot, mapPath).split(sep).join("/");
  return outputRelative.startsWith("static/");
}

const sleep = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

type UploadOutcome = "uploaded" | "updated" | "skipped" | "failed";

function hasUsableMappings(parsed: Record<string, unknown>): boolean {
  const regularMap =
    Array.isArray(parsed.sources) &&
    parsed.sources.length > 0 &&
    typeof parsed.mappings === "string" &&
    parsed.mappings.length > 0;
  const indexedMap =
    Array.isArray(parsed.sections) && parsed.sections.length > 0;
  return regularMap || indexedMap;
}

// Next creates several webpack compilers for one production build. Their
// output roots overlap, so each afterEmit hook can discover maps already seen
// by another compiler. Share in-flight and successful work across plugin
// instances to keep one build to one request per map. Failed uploads are
// evicted so a later compiler still gets one bounded recovery attempt.
const buildUploadOutcomes = new Map<string, Promise<UploadOutcome>>();

/**
 * Upload one `.js.map` to `POST /api/sourcemaps`.
 *
 * Auth: `Authorization: Bearer ${VOLATO_INGEST_TOKEN}`. The DSN must
 * not be used here — the ingest explicitly rejects DSN-bearing write
 * requests because the DSN lives in browser bundles and would let any
 * client forge sourcemap uploads.
 *
 * Privacy: `sourcesContent` is stripped before transit. This is the
 * load-bearing line for "your code stays in your repo" — Volato gets
 * file paths + identifier names + position mappings, never the source.
 *
 * Retries: bounded (3 attempts) on network errors and 5xx only. 4xx
 * surfaces immediately as a loud warning — these are misconfigurations
 * (wrong token, oversized map, malformed sourcemap) that retrying just
 * delays.
 */
export async function __uploadOneForTests(args: {
  mapPath: string;
  jsRelative: string;
  release: string;
  repositoryPrefix?: string;
  endpoint: string;
  token: string;
  fetchImpl: typeof fetch;
  warn: (msg: string) => void;
}): Promise<UploadOutcome> {
  return uploadOne(args);
}

async function uploadOne(args: {
  mapPath: string;
  jsRelative: string;
  release: string;
  repositoryPrefix?: string;
  endpoint: string;
  token: string;
  fetchImpl: typeof fetch;
  warn: (msg: string) => void;
}): Promise<UploadOutcome> {
  const key = projectFramePath(args.jsRelative);
  if (!key) {
    args.warn(
      `Skipping ${args.jsRelative} — no hashed filename, resolver cannot look this up.`,
    );
    return "skipped";
  }

  let sanitised: string;
  try {
    const raw = await readFile(args.mapPath, "utf8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!hasUsableMappings(parsed)) {
      args.warn(`Skipping ${args.jsRelative} — empty sourcemap has no mappings.`);
      return "skipped";
    }
    delete parsed.sourcesContent;
    delete parsed[REPOSITORY_PREFIX_FIELD];
    const repositoryPrefix = normalizeRepositoryPrefix(args.repositoryPrefix);
    if (repositoryPrefix) {
      parsed[REPOSITORY_PREFIX_FIELD] = repositoryPrefix;
    }
    sanitised = JSON.stringify(parsed);
  } catch {
    args.warn(`Skipping ${args.jsRelative} — sourcemap is not valid JSON.`);
    return "skipped";
  }

  const fd = new FormData();
  fd.set("release", args.release);
  fd.set("filename_hash", key.filename_hash);
  fd.set("display_path", key.display_path);
  fd.set(
    "map",
    new Blob([sanitised], { type: "application/json" }),
    `${key.filename_hash}.map`,
  );

  const url = new URL("/api/sourcemaps", args.endpoint);

  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      res = await args.fetchImpl(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${args.token}` },
        body: fd,
      });
    } catch (err) {
      if (attempt < RETRY_DELAYS_MS.length) {
        await sleep(RETRY_DELAYS_MS[attempt]!);
        continue;
      }
      args.warn(
        `Upload of ${args.jsRelative} failed after ${
          attempt + 1
        } attempts (network): ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return "failed";
    }

    if (res.status === 201) return "uploaded";
    if (res.status === 200) return "updated";

    if (res.status === 401) {
      args.warn(
        "VOLATO_INGEST_TOKEN rejected by ingest. Check it matches the project's ingestToken in the dashboard.",
      );
      return "failed";
    }

    if (res.status >= 500 && attempt < RETRY_DELAYS_MS.length) {
      await sleep(RETRY_DELAYS_MS[attempt]!);
      continue;
    }

    const text = await res.text().catch(() => "");
    args.warn(
      `Upload of ${args.jsRelative} failed: ${res.status} ${text}`.trim(),
    );
    return "failed";
  }
}

function uploadOncePerBuild(args: {
  mapPath: string;
  jsRelative: string;
  release: string;
  repositoryPrefix?: string;
  endpoint: string;
  token: string;
  fetchImpl: typeof fetch;
  warn: (msg: string) => void;
}): Promise<UploadOutcome> {
  const uploadKey = `${args.endpoint}\0${args.release}\0${args.mapPath}\0${args.jsRelative}`;
  const existing = buildUploadOutcomes.get(uploadKey);
  if (existing) return existing;

  const outcome = uploadOne(args).then(
    (result) => {
      if (result === "failed") buildUploadOutcomes.delete(uploadKey);
      return result;
    },
    (error: unknown) => {
      buildUploadOutcomes.delete(uploadKey);
      throw error;
    },
  );
  buildUploadOutcomes.set(uploadKey, outcome);
  return outcome;
}

async function withConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  async function pull(): Promise<void> {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await worker(items[i]!);
    }
  }
  const lanes = Array.from({ length: Math.min(limit, items.length) }, () =>
    pull(),
  );
  await Promise.all(lanes);
  return out;
}

async function sourceMapUploads(
  outputRoot: string,
  cwd: string,
  maps: readonly string[],
): Promise<SourceMapUpload[]> {
  const knownMaps = new Set(maps.map((mapPath) => resolve(mapPath)));
  const referencingJavaScript = new Map<string, Set<string>>();
  await withConcurrency(
    [...walkJavaScriptFiles(outputRoot)],
    UPLOAD_CONCURRENCY,
    async (jsPath) => {
      let source: string;
      try {
        source = await readFile(jsPath, "utf8");
      } catch {
        return;
      }
      const mapPath = referencedSourceMap(jsPath, source);
      if (!mapPath || !knownMaps.has(mapPath)) return;
      const references = referencingJavaScript.get(mapPath) ?? new Set();
      references.add(jsPath);
      referencingJavaScript.set(mapPath, references);
    },
  );

  return maps.flatMap((mapPath) => {
    const references = referencingJavaScript.get(resolve(mapPath));
    const javaScriptPaths =
      references && references.size > 0
        ? [...references]
        : [mapPath.replace(/\.map$/, "")];
    return javaScriptPaths.map((jsPath) => ({
      mapPath,
      jsRelative: relative(cwd, jsPath).split(sep).join("/"),
    }));
  });
}

/**
 * Test-only injection point. Not part of the stable API — the `__`
 * prefix signals "internal, may change". Production callers never
 * pass this; the plugin defaults to `fetch` and `process.cwd()`.
 */
export type __VolatoSourceMapsPluginInternals = {
  fetchImpl?: typeof fetch;
  cwd?: string;
  repositoryPrefix?: string;
  skipUploadBecauseDirty?: boolean;
};

export class __VolatoSourceMapsPlugin {
  constructor(
    private readonly opts: WithVolatoOptions,
    private readonly internals: __VolatoSourceMapsPluginInternals = {},
  ) {}

  apply(compiler: {
    options: { output?: { path?: string } };
    hooks: {
      afterEmit: {
        tapPromise: (name: string, cb: () => Promise<void>) => void;
      };
    };
  }): void {
    compiler.hooks.afterEmit.tapPromise("VolatoSourceMapsPlugin", async () => {
      const outputRoot = compiler.options.output?.path;
      if (!outputRoot) return;
      await this.uploadFromOutput(outputRoot);
    });
  }

  /** Shared by Webpack's `afterEmit` and Next.js 16's native build hook. */
  async uploadFromOutput(outputRoot: string): Promise<void> {
    const warn = (msg: string): void => {
      if (typeof console !== "undefined") console.warn(`[Volato] ${msg}`);
    };

    let endpoint: string | undefined;
    if (this.opts.uploadUrl) {
      try {
        endpoint = new URL(this.opts.uploadUrl).origin;
      } catch {
        throw new Error(
          `[Volato] uploadUrl "${this.opts.uploadUrl}" is not a valid URL; production sourcemaps cannot be uploaded.`,
        );
      }
    } else {
      const dsn = this.opts.dsn ?? process.env.NEXT_PUBLIC_VOLATO_DSN;
      if (!dsn) {
        throw new Error(
          "[Volato] NEXT_PUBLIC_VOLATO_DSN is required for the production sourcemap upload. Configure it or set disableUpload: true explicitly.",
        );
      }
      try {
        parseDSN(dsn);
        endpoint = dsnToIngestUrl(dsn).replace(/\/api\/ingest$/, "");
      } catch {
        throw new Error(
          "[Volato] NEXT_PUBLIC_VOLATO_DSN is not a valid DSN; production sourcemaps cannot be uploaded.",
        );
      }
    }

    const token = process.env.VOLATO_INGEST_TOKEN;
    if (!token) {
      throw new Error(
        "[Volato] VOLATO_INGEST_TOKEN is required for the production sourcemap upload. Configure it or set disableUpload: true explicitly.",
      );
    }

    const release = this.opts.release ?? detectRelease();
    if (!release) {
      throw new Error(
        "[Volato] no build commit could be detected; production sourcemaps cannot be uploaded. Ensure the build receives the checkout commit SHA.",
      );
    }

    const cwd = this.internals.cwd ?? process.cwd();
    const repositoryPrefix =
      this.internals.repositoryPrefix ?? detectRepositoryPrefix(cwd);
    const fetchImpl = this.internals.fetchImpl ?? fetch;
    const hide = this.opts.hideSourceMaps ?? true;

    const maps: string[] = [];
    for (const mapPath of walkJsMapFiles(outputRoot)) maps.push(mapPath);
    if (maps.length === 0) return;

    if (this.internals.skipUploadBecauseDirty) {
      if (hide) {
        await Promise.all(
          maps
            .filter((mapPath) => isPublicBrowserMap(outputRoot, mapPath))
            .map(async (mapPath) => {
              try {
                await unlink(mapPath);
              } catch {
                // best-effort
              }
            }),
        );
      }
      warn(
        "sourcemaps were not uploaded because the release was inferred from Git " +
          "but the worktree has uncommitted changes. Commit the build inputs or " +
          "set VOLATO_RELEASE explicitly for this build.",
      );
      return;
    }

    const uploads = await sourceMapUploads(outputRoot, cwd, maps);
    const outcomes = await withConcurrency(
      uploads,
      UPLOAD_CONCURRENCY,
      async (upload) =>
        uploadOncePerBuild({
          mapPath: upload.mapPath,
          jsRelative: upload.jsRelative,
          release,
          repositoryPrefix,
          endpoint: endpoint!,
          token,
          fetchImpl,
          warn,
        }),
    );

    if (hide) {
      const successfulMaps = maps.filter((mapPath) => {
        const related = uploads.flatMap((upload, index) =>
          upload.mapPath === mapPath ? [outcomes[index]!] : [],
        );
        return (
          related.length > 0 &&
          related.every(
            (outcome) => outcome === "uploaded" || outcome === "updated",
          )
        );
      });
      await Promise.all(
        successfulMaps
          .filter((mapPath) => isPublicBrowserMap(outputRoot, mapPath))
          .map(async (mapPath) => {
            try {
              await unlink(mapPath);
            } catch {
              // best-effort
            }
          }),
      );
    }

    const failed = outcomes.filter((o) => o === "failed").length;
    if (failed > 0) {
      const message = `${failed}/${outcomes.length} sourcemap(s) failed to upload; refusing a green production build with incomplete source resolution.`;
      warn(message);
      throw new Error(`[Volato] ${message}`);
    }
  }
}

type NextCompilerMetadata = {
  projectDir: string;
  distDir: string;
};

type NextCompilerConfig = {
  runAfterProductionCompile?: (metadata: NextCompilerMetadata) => Promise<void>;
  [k: string]: unknown;
};

type NextConfigLike = {
  productionBrowserSourceMaps?: boolean;
  // Next's `ExperimentalConfig` is structurally an object but deliberately
  // has no string index signature. Keep this broad enough for the official
  // `NextConfig` type while still guaranteeing it is safe to spread.
  experimental?: object;
  compiler?: NextCompilerConfig;
  // Params widened to `any` because Next.js's own webpack callback type
  // (WebpackConfiguration, WebpackConfigContext) -> WebpackConfiguration
  // is invariant under TS strict mode — `unknown` params would reject
  // every real NextConfig at the call site.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  webpack?: ((config: any, ctx: any) => any) | null;
  [k: string]: unknown;
};

// Next accepts either a config object or a sync/async config factory. Keep the
// factory shape broad enough to preserve Next's phase and default-config
// arguments without importing `next` into the generated integration.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type NextConfigFactory = (...args: any[]) =>
  | NextConfigLike
  | Promise<NextConfigLike>;

type VolatoWrappedFactory<T extends NextConfigFactory> = (
  ...args: Parameters<T>
) => ReturnType<T> extends Promise<infer TConfig>
  ? Promise<TConfig & NextConfigLike>
  : ReturnType<T> & NextConfigLike;

/**
 * Resolve the current build's commit SHA from `git rev-parse HEAD`.
 *
 * Runs once at `next.config.ts` load time. The shell-out is sub-ms
 * in a real repo; we still cap it at 1 second to defend against an
 * unhealthy git or a file-system stall. The result is validated as a
 * 40-char hex SHA — anything else (warning text on a misconfigured
 * git, empty output) is treated as a miss and we return undefined.
 *
 * Returns undefined on the three real-world failure modes:
 *   - `.git` is missing (Docker build that excluded it via
 *     `.dockerignore`, or `git clone --depth=0`)
 *   - the `git` binary isn't on `PATH` (minimal alpine, distroless)
 *   - the subprocess hangs and trips the 1s timeout
 *
 * Caller is expected to fall back gracefully — the downstream warning
 * in the sourcemap-upload plugin already covers the "no release tag"
 * case loudly. We never throw from here.
 *
 * Why not read provider env vars (`VERCEL_GIT_COMMIT_SHA`, `COMMIT_REF`,
 * `CF_PAGES_COMMIT_SHA`, etc.)? Clean-room policy. Git is the universal
 * tool every Next.js project already uses; baking hoster-specific names
 * into generated source would couple us to those companies' naming conventions.
 */
function detectGitSha(cwd?: string): string | undefined {
  try {
    const out = execSync("git rev-parse HEAD", {
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 1000,
      encoding: "utf8",
      cwd,
    }).trim();
    return /^[a-f0-9]{40}$/.test(out) ? out : undefined;
  } catch {
    return undefined;
  }
}

function gitWorktreeIsClean(cwd?: string): boolean {
  try {
    return (
      execSync("git status --porcelain=v1 --untracked-files=normal", {
        stdio: ["ignore", "pipe", "ignore"],
        timeout: 1000,
        encoding: "utf8",
        cwd,
      }).trim() === ""
    );
  } catch {
    return false;
  }
}

function normalizeRepositoryPrefix(
  value: string | undefined,
): string | undefined {
  if (!value) return undefined;
  const normalized = value
    .trim()
    .replaceAll("\\", "/")
    .replace(/^\.\//, "")
    .replace(/\/+$/, "");
  const segments = normalized.split("/");
  if (
    !normalized ||
    isAbsolute(normalized) ||
    /^[a-zA-Z]:\//.test(normalized) ||
    segments.some(
      (segment) => segment === "" || segment === "." || segment === "..",
    )
  ) {
    return undefined;
  }
  return normalized;
}

function workspaceRoot(cwd: string): string | undefined {
  let current = resolve(cwd);
  while (true) {
    if (existsSync(join(current, "pnpm-workspace.yaml"))) return current;
    const parent = dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

function detectRepositoryPrefix(cwd = process.cwd()): string | undefined {
  let root: string | undefined;
  try {
    root = execSync("git rev-parse --show-toplevel", {
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 1000,
      encoding: "utf8",
      cwd,
    }).trim();
  } catch {
    root = workspaceRoot(cwd);
  }
  if (!root) return undefined;
  return normalizeRepositoryPrefix(relative(root, resolve(cwd)));
}

/** Test-only — exposes `detectGitSha` for direct assertion. */
export function __detectGitShaForTests(cwd?: string): string | undefined {
  return detectGitSha(cwd);
}

/** Test-only — exposes repository-prefix detection for monorepo builds. */
export function __detectRepositoryPrefixForTests(
  cwd?: string,
): string | undefined {
  return detectRepositoryPrefix(cwd);
}

/** Test-only — exposes the build-identity env merge for direct assertion. */
export function __buildEnvWithIdentityForTests(
  existingEnv: unknown,
  release: string | undefined,
  commitSha: string | undefined,
): Record<string, string> {
  return buildEnvWithIdentity(existingEnv, release, commitSha);
}

/**
 * Merge a release tag into the `env` block of the returned Next.js
 * config so Next inlines it into both server and client bundles via
 * DefinePlugin. The generated runtime's `detectRelease()` reads the inlined value
 * statically — see `internal/release.ts` for why static access is
 * load-bearing here.
 *
 * The user's own entries in `nextConfig.env` are preserved untouched,
 * and we never overwrite release or commit identity entries that already
 * exist in `nextConfig.env` — the user wired them manually for a reason.
 *
 * Pure: both identities are resolved by the caller. Keeps the function testable
 * in isolation from the `execSync` shell-out.
 */
function buildEnvWithIdentity(
  existingEnv: unknown,
  release: string | undefined,
  commitSha: string | undefined,
): Record<string, string> {
  const userEnv: Record<string, string> =
    existingEnv &&
    typeof existingEnv === "object" &&
    !Array.isArray(existingEnv)
      ? { ...(existingEnv as Record<string, string>) }
      : {};

  if (release) {
    if (!("VOLATO_RELEASE" in userEnv)) userEnv.VOLATO_RELEASE = release;
    if (!("NEXT_PUBLIC_VOLATO_RELEASE" in userEnv)) {
      userEnv.NEXT_PUBLIC_VOLATO_RELEASE = release;
    }
  }
  if (commitSha) {
    if (!("VOLATO_COMMIT_SHA" in userEnv)) {
      userEnv.VOLATO_COMMIT_SHA = commitSha;
    }
    if (!("NEXT_PUBLIC_VOLATO_COMMIT_SHA" in userEnv)) {
      userEnv.NEXT_PUBLIC_VOLATO_COMMIT_SHA = commitSha;
    }
  }
  return userEnv;
}

/**
 * Resolve the release tag from the precedence chain :
 *
 *   1. `options.release` (explicit override at the `withVolato()` call site)
 *   2. `process.env.VOLATO_RELEASE` (user set it in shell / `.env`)
 *   3. `detectGitSha()` (the auto-detect path most users land on)
 *
 * Returns undefined when none of the three yields a value.
 */
function explicitRelease(options: WithVolatoOptions): string | undefined {
  const configured =
    options.release?.trim() || process.env.VOLATO_RELEASE?.trim();
  return configured || undefined;
}

/**
 * Wrap a Next.js config to enable production browser source maps and
 * upload them to Volato at build time.
 *
 *   // next.config.ts
 *   import { withVolato } from "./volato/withVolato";
 *   export default withVolato({ reactStrictMode: true });
 */
export function withVolato<T extends NextConfigFactory>(
  nextConfig: T,
  options?: WithVolatoOptions,
): VolatoWrappedFactory<T>;
export function withVolato<T extends NextConfigLike = NextConfigLike>(
  nextConfig: T,
  options?: WithVolatoOptions,
): T;
export function withVolato(
  nextConfig: NextConfigLike | NextConfigFactory,
  options: WithVolatoOptions = {},
): NextConfigLike | NextConfigFactory {
  if (typeof nextConfig === "function") {
    const configFactory = nextConfig;
    return function wrappedNextConfig(this: unknown, ...args: unknown[]) {
      const config = configFactory.apply(this, args);
      if (
        config !== null &&
        typeof config === "object" &&
        "then" in config &&
        typeof config.then === "function"
      ) {
        return Promise.resolve(config).then((resolvedConfig) =>
          withVolato(resolvedConfig as NextConfigLike, options),
        );
      }
      return withVolato(config as NextConfigLike, options);
    };
  }

  // Resolve once and reuse the exact same build identifier for both sides of
  // symbolication: the value inlined into runtime events and the value sent
  // with uploaded sourcemaps. Re-detecting inside the webpack plugin breaks in
  // container builds where `.git` is intentionally absent from the build
  // context, and previously allowed the two paths to disagree.
  const configuredCommitSha =
    options.commitSha?.trim() || process.env.VOLATO_COMMIT_SHA?.trim();
  const validatedCommitSha =
    configuredCommitSha && /^[a-f0-9]{7,40}$/i.test(configuredCommitSha)
      ? configuredCommitSha
      : undefined;
  const autoDetectedCommitSha = validatedCommitSha ? undefined : detectGitSha();
  const commitSha = validatedCommitSha ?? autoDetectedCommitSha;
  const configuredRelease = explicitRelease(options);
  const release = configuredRelease ?? commitSha;
  const skipUploadBecauseDirty = Boolean(
    release &&
      !configuredRelease &&
      !validatedCommitSha &&
      autoDetectedCommitSha &&
      !gitWorktreeIsClean(),
  );
  const resolvedOptions = release ? { ...options, release } : options;

  if (options.disableUpload) {
    return {
      ...nextConfig,
      productionBrowserSourceMaps: true,
      experimental: {
        ...nextConfig.experimental,
        serverSourceMaps: true,
      },
      env: buildEnvWithIdentity(nextConfig.env, release, commitSha),
    };
  }

  // Build-time warning. The token gates the entire sourcemap upload
  // path; without it, the platform never gets a `.map` and every
  // browser frame the agent sees in fix_context stays minified
  // (chunks/page-abc.js:1:23456 instead of app/page.tsx:42). Fires
  // once per `next.config` load — `next build`, `next dev`,
  // `next start` — at the cost of a single stderr line. No CI/prod
  // gating: the failure mode the warning catches (token missing in
  // CI) is decided during development, so dev needs to see it too.
  // `--quiet` upstream of Next does not silence the message; that's
  // intentional. The opt-out is `disableUpload: true`, already
  // handled by the early return above.
  if (!process.env.VOLATO_INGEST_TOKEN && typeof console !== "undefined") {
    console.warn(
      "[Volato] VOLATO_INGEST_TOKEN is not set — sourcemaps will not be uploaded. " +
        "Without a token, errors firing in production show minified frames " +
        "(chunks/page-abc.js:1:23456) instead of original paths (app/page.tsx:42). " +
        "Configure the token in your CI environment to enable source resolution.",
    );
  }

  if ((options.nextMajor ?? 15) >= 16) {
    const userAfterProductionCompile =
      nextConfig.compiler?.runAfterProductionCompile;
    return {
      ...nextConfig,
      productionBrowserSourceMaps: true,
      experimental: {
        ...nextConfig.experimental,
        serverSourceMaps: true,
      },
      env: buildEnvWithIdentity(nextConfig.env, release, commitSha),
      compiler: {
        ...nextConfig.compiler,
        async runAfterProductionCompile(metadata: NextCompilerMetadata) {
          await userAfterProductionCompile?.(metadata);
          const outputRoot = isAbsolute(metadata.distDir)
            ? metadata.distDir
            : resolve(metadata.projectDir, metadata.distDir);
          const uploader = new __VolatoSourceMapsPlugin(resolvedOptions, {
            cwd: metadata.projectDir,
            skipUploadBecauseDirty,
          });

          // At this official hook Next 16 has emitted server maps. Turbopack
          // materializes browser maps during later post-compilation work; the
          // generated postbuild.cjs handles that final public set.
          await uploader.uploadFromOutput(outputRoot);
        },
      },
    };
  }

  const userWebpack = nextConfig.webpack;
  return {
    ...nextConfig,
    productionBrowserSourceMaps: true,
    experimental: {
      ...nextConfig.experimental,
      serverSourceMaps: true,
    },
    env: buildEnvWithIdentity(nextConfig.env, release, commitSha),
    webpack(
      config: { plugins?: unknown[] } & Record<string, unknown>,
      ctx: { isServer?: boolean; dev?: boolean },
    ) {
      const next = userWebpack ? userWebpack(config, ctx) : config;
      if (
        ctx.dev !== true &&
        typeof next === "object" &&
        next !== null &&
        "plugins" in next
      ) {
        const plugins = (next as { plugins?: unknown[] }).plugins ?? [];
        plugins.push(
          new __VolatoSourceMapsPlugin(resolvedOptions, {
            skipUploadBecauseDirty,
          }),
        );
        (next as { plugins?: unknown[] }).plugins = plugins;
      }
      return next;
    },
  };
}
