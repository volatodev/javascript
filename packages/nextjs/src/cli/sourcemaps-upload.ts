/**
 * `volato sourcemaps upload` — walk the Next.js build output, derive
 * a stable lookup key for each `.map`, and ship them to
 * `POST /api/sourcemaps`.
 *
 * Manual workflow only (no `withVolato({ uploadSourcemaps: true })`
 * auto-hook in v0). Recommended sequence in a CI pipeline:
 *
 *   pnpm build
 *   npx volato sourcemaps upload
 *   <deploy command>
 *
 * Sequential because the deploy promotes traffic; if maps haven't
 * landed before the first prod error fires, the resolver hits a
 * TOCTOU window and falls back to the unresolved frame. The MCP
 * resolver also has a 5-second grace window for the very first
 * miss, but that's a safety net, not a license to skip ordering.
 *
 * Phase D.3 of the sourcemaps work.
 */

import { createReadStream } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { parseDSN, projectFramePath } from "@volatodev/core";
import { detectRelease } from "../internal/release";

export type UploadOptions = {
  /** Falls back to `VOLATO_INGEST_TOKEN`. */
  token?: string;
  /**
   * Override the ingest origin (e.g. `https://ingest.volato.dev`).
   * When omitted, the origin is derived from `NEXT_PUBLIC_VOLATO_DSN`
   * — the same DSN the SDK uses at runtime, so there is no second URL
   * to keep in sync.
   */
  endpoint?: string;
  /** Falls back to detectRelease() — VOLATO_RELEASE / NEXT_PUBLIC_VOLATO_RELEASE. */
  release?: string;
  /** Default `.next` (relative to cwd). */
  buildDir?: string;
  /** Default 8. */
  concurrency?: number;
  /** Override the working directory (test-only). */
  cwd?: string;
  /** Override the global `fetch` (test-only). */
  fetchImpl?: typeof fetch;
  /** Capture stdout instead of writing to it (test-only). */
  stdout?: (line: string) => void;
  /** Capture stderr instead of writing to it (test-only). */
  stderr?: (line: string) => void;
};

export type UploadSummary = {
  uploaded: number;
  updated: number;
  skipped: number;
  failed: number;
};

/**
 * Recursively collect `.js.map` paths under `${root}/static/chunks`.
 * Server-side maps (`${root}/server/...`) are out of scope for v0.
 */
async function listClientMaps(buildDir: string): Promise<string[]> {
  const root = join(buildDir, "static", "chunks");
  let rootStat;
  try {
    rootStat = await stat(root);
  } catch {
    return [];
  }
  if (!rootStat.isDirectory()) return [];

  const out: string[] = [];
  async function walk(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      const full = join(dir, e.name);
      if (e.isDirectory()) {
        await walk(full);
      } else if (e.isFile() && e.name.endsWith(".js.map")) {
        out.push(full);
      }
    }
  }
  await walk(root);
  return out;
}

/**
 * Run `worker` over `items` with at most `limit` in flight at once.
 * Avoids a `p-limit` dependency for one specific use case.
 */
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
  const lanes = Array.from(
    { length: Math.min(limit, items.length) },
    () => pull(),
  );
  await Promise.all(lanes);
  return out;
}

type UploadOutcome = "uploaded" | "updated" | "skipped" | "failed";

async function uploadOne(args: {
  mapPath: string;
  buildDir: string;
  cwd: string;
  release: string;
  endpoint: string;
  token: string;
  fetchImpl: typeof fetch;
  warn: (line: string) => void;
}): Promise<UploadOutcome> {
  const buildDirRelative = relative(args.cwd, args.mapPath).split(sep).join("/");
  // Derive the corresponding `.js` path; that's what we hand to the
  // projection function (Next.js stack frames reference the .js, not
  // the .map).
  const jsRelative = buildDirRelative.replace(/\.map$/, "");

  const key = projectFramePath(jsRelative);
  if (!key) {
    args.warn(
      `[Volato] Skipping ${jsRelative} — no hashed filename, resolver could not look it up.\n`,
    );
    return "skipped";
  }

  const fd = new FormData();
  fd.set("release", args.release);
  fd.set("filename_hash", key.filename_hash);
  fd.set("display_path", key.display_path);

  // Read the file synchronously into a Blob — Next.js maps top out
  // at a few MB; streaming via undici-specific APIs is not portable.
  const stream = createReadStream(args.mapPath);
  const chunks: Uint8Array[] = [];
  for await (const chunk of stream) {
    chunks.push(chunk as Uint8Array);
  }
  const total = chunks.reduce((acc, c) => acc + c.length, 0);
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    merged.set(c, offset);
    offset += c.length;
  }
  fd.set(
    "map",
    new Blob([merged], { type: "application/json" }),
    `${key.filename_hash}.map`,
  );

  const url = new URL("/api/sourcemaps", args.endpoint);
  let res: Response;
  try {
    res = await args.fetchImpl(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${args.token}` },
      body: fd,
    });
  } catch (err) {
    args.warn(
      `[Volato] Network failure uploading ${jsRelative}: ${
        err instanceof Error ? err.message : String(err)
      }\n`,
    );
    return "failed";
  }

  if (res.status === 201) return "uploaded";
  if (res.status === 200) return "updated";

  // Anything else is a failure surfaced to the operator.
  const text = await res.text().catch(() => "");
  args.warn(
    `[Volato] Upload failed for ${jsRelative}: ${res.status} ${text}\n`,
  );
  return "failed";
}

/**
 * Pull the ingest origin out of `NEXT_PUBLIC_VOLATO_DSN`. The DSN encodes
 * the host as `https://<key>@<host>/<projectId>`, so it's already the
 * canonical "where do I send" value; no second URL env var to maintain.
 */
function deriveEndpointFromDsn(): string | undefined {
  const dsn = process.env.NEXT_PUBLIC_VOLATO_DSN;
  if (!dsn) return undefined;
  try {
    return parseDSN(dsn).origin;
  } catch {
    return undefined;
  }
}

export async function runUpload(opts: UploadOptions): Promise<UploadSummary> {
  const token = opts.token ?? process.env.VOLATO_INGEST_TOKEN;
  if (!token) {
    throw new Error(
      "Missing ingest token. Pass --token or set VOLATO_INGEST_TOKEN. " +
        "Find it in your project's dashboard.",
    );
  }

  const endpoint = opts.endpoint ?? deriveEndpointFromDsn();
  if (!endpoint) {
    throw new Error(
      "Missing ingest endpoint. Set NEXT_PUBLIC_VOLATO_DSN (the SDK's own " +
        "DSN already encodes the ingest host) or pass --endpoint to override.",
    );
  }

  const release = opts.release ?? detectRelease();
  if (!release) {
    throw new Error(
      "Missing release. Pass --release or set VOLATO_RELEASE / " +
        "NEXT_PUBLIC_VOLATO_RELEASE (typically your commit SHA).",
    );
  }

  const cwd = opts.cwd ?? process.cwd();
  const buildDir = resolve(cwd, opts.buildDir ?? ".next");
  const concurrency = opts.concurrency ?? 8;
  const fetchImpl = opts.fetchImpl ?? fetch;
  const out = opts.stdout ?? ((line) => process.stdout.write(line));
  const warn = opts.stderr ?? ((line) => process.stderr.write(line));

  const maps = await listClientMaps(buildDir);
  if (maps.length === 0) {
    out(
      `[Volato] No client sourcemaps under ${buildDir}/static/chunks. ` +
        `Did you run \`next build\` with sourcemaps enabled?\n`,
    );
    return { uploaded: 0, updated: 0, skipped: 0, failed: 0 };
  }

  const summary: UploadSummary = {
    uploaded: 0,
    updated: 0,
    skipped: 0,
    failed: 0,
  };

  const outcomes = await withConcurrency(maps, concurrency, (mapPath) =>
    uploadOne({
      mapPath,
      buildDir,
      cwd,
      release,
      endpoint,
      token,
      fetchImpl,
      warn,
    }),
  );

  for (const o of outcomes) summary[o] += 1;

  out(
    `Uploaded ${summary.uploaded}, updated ${summary.updated}, ` +
      `skipped ${summary.skipped}, failed ${summary.failed} ` +
      `(release ${release}).\n`,
  );

  return summary;
}
