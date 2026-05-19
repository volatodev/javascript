/**
 * `withVolato(nextConfig, options)` — wraps a Next.js config to:
 *
 *   1. Force-enable production browser source maps so a real stack can be
 *      symbolicated.
 *   2. Inject a webpack plugin that, after build, POSTs every `.map` file
 *      under the build output to the project's source-map upload endpoint.
 *   3. Optionally delete the `.map` files from the served output so they
 *      don't ship to end users (`hideSourceMaps: true`).
 *
 * Server-side only: this module imports `node:fs` / `node:path` and is
 * meant to live in `next.config.{js,ts}`. Never import it from
 * client-side code or middleware.
 */

import { readdirSync, readFileSync, statSync, unlinkSync } from "node:fs";
import { join, relative } from "node:path";
import { dsnToIngestUrl, parseDSN } from "@volatodev/core";

export type WithVolatoOptions = {
  /**
   * DSN to attach to uploaded source maps. Defaults to
   * `process.env.NEXT_PUBLIC_VOLATO_DSN`. The webpack plugin runs at
   * build time so `process.env` is the natural place to read it from.
   */
  dsn?: string;
  /**
   * Release identifier the maps belong to. Defaults to
   * `process.env.VOLATO_RELEASE`. Source-map symbolication keys on this.
   */
  release?: string;
  /**
   * Delete `.map` files from the build output after upload so they
   * aren't served to end users. Default `true` for production builds.
   */
  hideSourceMaps?: boolean;
  /**
   * Skip the upload entirely (still emits maps). Useful for local dev
   * loops where you don't want every `next build` to hit the network.
   * Default `false`.
   */
  disableUpload?: boolean;
  /**
   * Override the upload endpoint. Defaults to
   * `${ingest_origin}/api/sourcemaps`.
   */
  uploadUrl?: string;
};

const MAX_MAP_BYTES = 10 * 1024 * 1024; // 10 MB hard cap; bigger = skip

// Directories under the build output that must NOT be walked for map
// uploads. `cache/` is webpack's persistent build cache — full of
// `.map` files from previous compilations that are not part of the
// served bundle. Walking them would upload thousands of stale,
// useless source maps every build.
const SKIP_DIRS = new Set([
  "cache",
  ".cache",
  "node_modules",
]);

function* walkMapFiles(root: string): Iterable<string> {
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
      yield* walkMapFiles(full);
    } else if (s.isFile() && full.endsWith(".map")) {
      yield full;
    }
  }
}

async function uploadMap(
  uploadUrl: string,
  dsn: string,
  release: string | undefined,
  filename: string,
  content: string,
): Promise<void> {
  try {
    await fetch(uploadUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Volato-DSN": dsn,
        ...(release ? { "X-Volato-Release": release } : {}),
      },
      body: JSON.stringify({ filename, content }),
    });
  } catch {
    // Build must never fail because of a sourcemap upload error.
  }
}

class VolatoSourceMapsPlugin {
  constructor(private readonly opts: WithVolatoOptions) {}

  apply(compiler: {
    options: { output?: { path?: string } };
    hooks: {
      afterEmit: { tapPromise: (name: string, cb: () => Promise<void>) => void };
    };
  }): void {
    compiler.hooks.afterEmit.tapPromise(
      "VolatoSourceMapsPlugin",
      async () => {
        const dsn = this.opts.dsn ?? process.env.NEXT_PUBLIC_VOLATO_DSN;
        if (!dsn) return;
        try {
          parseDSN(dsn);
        } catch {
          return;
        }
        const release = this.opts.release ?? process.env.VOLATO_RELEASE;
        const uploadUrl =
          this.opts.uploadUrl ?? `${dsnToIngestUrl(dsn).replace(/\/api\/ingest$/, "")}/api/sourcemaps`;
        const outputRoot = compiler.options.output?.path;
        if (!outputRoot) return;

        const hide = this.opts.hideSourceMaps ?? true;
        const skipped: string[] = [];

        for (const mapPath of walkMapFiles(outputRoot)) {
          let content: string;
          try {
            const stat = statSync(mapPath);
            if (stat.size > MAX_MAP_BYTES) {
              skipped.push(`${relative(outputRoot, mapPath)} (${Math.round(stat.size / 1024)}KB)`);
              continue;
            }
            content = readFileSync(mapPath, "utf8");
          } catch {
            continue;
          }
          const rel = relative(outputRoot, mapPath);
          await uploadMap(uploadUrl, dsn, release, rel, content);
          if (hide) {
            try {
              unlinkSync(mapPath);
            } catch {
              // best-effort
            }
          }
        }

        if (skipped.length > 0 && typeof console !== "undefined") {
          console.warn(
            `[Volato] Skipped ${skipped.length} source map(s) larger than ${MAX_MAP_BYTES / 1024 / 1024}MB — these are exactly the bundles you'd most want symbolicated. Consider splitting your chunks. First few skipped:\n  - ${skipped.slice(0, 5).join("\n  - ")}`,
          );
        }
      },
    );
  }
}

type NextConfigLike = {
  productionBrowserSourceMaps?: boolean;
  // Params widened to `any` because Next.js's own webpack callback type
  // (WebpackConfiguration, WebpackConfigContext) -> WebpackConfiguration
  // is invariant under TS strict mode — `unknown` params would reject
  // every real NextConfig at the call site.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  webpack?: ((config: any, ctx: any) => any) | null;
  [k: string]: unknown;
};

/**
 * Wrap a Next.js config to enable production browser source maps and
 * upload them to Volato at build time.
 *
 *   // next.config.ts
 *   import { withVolato } from "@volatodev/nextjs";
 *   export default withVolato({ reactStrictMode: true });
 */
export function withVolato<T extends NextConfigLike = NextConfigLike>(
  nextConfig: T,
  options: WithVolatoOptions = {},
): T {
  if (options.disableUpload) {
    return { ...nextConfig, productionBrowserSourceMaps: true };
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

  const userWebpack = nextConfig.webpack;
  return {
    ...nextConfig,
    productionBrowserSourceMaps: true,
    webpack(
      config: { plugins?: unknown[] } & Record<string, unknown>,
      ctx: { isServer?: boolean },
    ) {
      const next = userWebpack ? userWebpack(config, ctx) : config;
      // Source maps for the browser bundle only — server-side maps live
      // in the user's own infra and don't need symbolication.
      if (
        !ctx.isServer &&
        typeof next === "object" &&
        next !== null &&
        "plugins" in next
      ) {
        const plugins = (next as { plugins?: unknown[] }).plugins ?? [];
        plugins.push(new VolatoSourceMapsPlugin(options));
        (next as { plugins?: unknown[] }).plugins = plugins;
      }
      return next;
    },
  } as T;
}
