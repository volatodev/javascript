/**
 * Auto-detect release / environment / dist from Volato-owned env vars.
 *
 * Priority (first non-empty wins):
 *
 *   release:       VOLATO_RELEASE | NEXT_PUBLIC_VOLATO_RELEASE
 *   environment:   VOLATO_ENVIRONMENT | NEXT_PUBLIC_VOLATO_ENVIRONMENT
 *                  | NODE_ENV
 *   dist:          VOLATO_DIST | NEXT_PUBLIC_VOLATO_DIST
 *
 * Browser bundles see the `NEXT_PUBLIC_*` form because Next replaces it
 * at build time. Server sees both. Reads are memoized: env doesn't change
 * between events, so we don't re-walk the env on every capture.
 *
 * The SDK does not read provider-specific env vars (no Vercel, Netlify,
 * Cloudflare, etc.). Users hosting on a provider that exposes a build SHA
 * map it themselves to `VOLATO_RELEASE`, e.g. in `next.config`:
 *
 *   process.env.VOLATO_RELEASE ??= process.env.VERCEL_GIT_COMMIT_SHA;
 */

function readEnv(name: string): string | undefined {
  if (typeof process === "undefined" || !process.env) return undefined;
  const v = process.env[name];
  if (typeof v !== "string") return undefined;
  const trimmed = v.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function firstOf(names: readonly string[]): string | undefined {
  for (const name of names) {
    const v = readEnv(name);
    if (v) return v;
  }
  return undefined;
}

const RELEASE_VARS = [
  "VOLATO_RELEASE",
  "NEXT_PUBLIC_VOLATO_RELEASE",
] as const;

const ENV_VARS = [
  "VOLATO_ENVIRONMENT",
  "NEXT_PUBLIC_VOLATO_ENVIRONMENT",
  "NODE_ENV",
] as const;

const DIST_VARS = [
  "VOLATO_DIST",
  "NEXT_PUBLIC_VOLATO_DIST",
] as const;

let cachedRelease: string | null | undefined;
let cachedEnvironment: string | null | undefined;
let cachedDist: string | null | undefined;

export function detectRelease(): string | undefined {
  if (cachedRelease === undefined) cachedRelease = firstOf(RELEASE_VARS) ?? null;
  return cachedRelease ?? undefined;
}

export function detectEnvironment(): string | undefined {
  if (cachedEnvironment === undefined) {
    cachedEnvironment = firstOf(ENV_VARS) ?? null;
  }
  return cachedEnvironment ?? undefined;
}

export function detectDist(): string | undefined {
  if (cachedDist === undefined) cachedDist = firstOf(DIST_VARS) ?? null;
  return cachedDist ?? undefined;
}

/**
 * Apply detected release / environment / dist onto an event payload.
 * Existing explicit values on the event are preserved — auto-detection
 * never overwrites a user-supplied field.
 */
export function applyReleaseTo(event: Record<string, unknown>): void {
  if (!event.release) {
    const r = detectRelease();
    if (r) event.release = r;
  }
  if (!event.environment) {
    const e = detectEnvironment();
    if (e) event.environment = e;
  }
  if (!event.dist) {
    const d = detectDist();
    if (d) event.dist = d;
  }
}

/** Test-only — invalidate the memoized release/env/dist cache. */
export function __resetReleaseCacheForTests(): void {
  cachedRelease = undefined;
  cachedEnvironment = undefined;
  cachedDist = undefined;
}
