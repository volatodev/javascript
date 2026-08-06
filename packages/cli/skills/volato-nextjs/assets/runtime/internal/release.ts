/**
 * Auto-detect release / environment / dist from Volato-owned env vars.
 *
 * Priority (first non-empty wins):
 *
 *   release:       VOLATO_RELEASE | NEXT_PUBLIC_VOLATO_RELEASE
 *   commit SHA:    VOLATO_COMMIT_SHA | NEXT_PUBLIC_VOLATO_COMMIT_SHA
 *   environment:   VOLATO_ENVIRONMENT | NEXT_PUBLIC_VOLATO_ENVIRONMENT
 *                  | NODE_ENV
 *   dist:          VOLATO_DIST | NEXT_PUBLIC_VOLATO_DIST
 *
 * **Static env access on purpose.** Webpack's DefinePlugin (which Next
 * uses to inline `NEXT_PUBLIC_*` into client bundles, and which we
 * piggy-back on by setting `env: { VOLATO_RELEASE: ... }` in
 * `withVolato()`) only replaces *static* `process.env.SOMETHING`
 * references. A dynamic read via `process.env[name]` would compile to
 * a lookup on an object that doesn't exist in the browser. Each
 * reachable env var is therefore named in code below, not pulled from
 * a list. Reads are memoized: env doesn't change between events, so
 * we don't re-evaluate the chain on every capture.
 *
 * Generated source does not read provider-specific env vars (no Vercel,
 * Netlify, Cloudflare, etc.). Release tagging is auto-handled by
 * `withVolato()`, which runs `git rev-parse HEAD` at build time and
 * injects the SHA into Next's `env` config. A user wanting to override
 * — e.g. shipping with a semver tag instead of a commit SHA — sets
 * `VOLATO_RELEASE` explicitly in their CI env; the explicit value
 * takes precedence over the git-derived one.
 */

function trimmed(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const s = v.trim();
  return s.length > 0 ? s : undefined;
}

let cachedRelease: string | null | undefined;
let cachedCommitSha: string | null | undefined;
let cachedEnvironment: string | null | undefined;
let cachedDist: string | null | undefined;

export function detectRelease(): string | undefined {
  if (cachedRelease === undefined) {
    // Keep the complete `process.env.NAME` expression intact. Next.js's
    // DefinePlugin cannot replace an aliased access such as
    // `const env = process.env; env.NAME`.
    const hasProcessEnv =
      typeof process !== "undefined" && Boolean(process.env);
    const fromServer = hasProcessEnv
      ? trimmed(process.env.VOLATO_RELEASE)
      : undefined;
    const fromPublic = hasProcessEnv
      ? trimmed(process.env.NEXT_PUBLIC_VOLATO_RELEASE)
      : undefined;
    cachedRelease = fromServer ?? fromPublic ?? null;
  }
  return cachedRelease ?? undefined;
}

export function detectCommitSha(): string | undefined {
  if (cachedCommitSha === undefined) {
    const hasProcessEnv =
      typeof process !== "undefined" && Boolean(process.env);
    const fromServer = hasProcessEnv
      ? trimmed(process.env.VOLATO_COMMIT_SHA)
      : undefined;
    const fromPublic = hasProcessEnv
      ? trimmed(process.env.NEXT_PUBLIC_VOLATO_COMMIT_SHA)
      : undefined;
    const candidate = fromServer ?? fromPublic;
    cachedCommitSha =
      candidate && /^[a-f0-9]{7,40}$/i.test(candidate) ? candidate : null;
  }
  return cachedCommitSha ?? undefined;
}

export function detectEnvironment(): string | undefined {
  if (cachedEnvironment === undefined) {
    const hasProcessEnv =
      typeof process !== "undefined" && Boolean(process.env);
    const fromServer = hasProcessEnv
      ? trimmed(process.env.VOLATO_ENVIRONMENT)
      : undefined;
    const fromPublic = hasProcessEnv
      ? trimmed(process.env.NEXT_PUBLIC_VOLATO_ENVIRONMENT)
      : undefined;
    const fromNode = hasProcessEnv ? trimmed(process.env.NODE_ENV) : undefined;
    cachedEnvironment = fromServer ?? fromPublic ?? fromNode ?? null;
  }
  return cachedEnvironment ?? undefined;
}

export function detectDist(): string | undefined {
  if (cachedDist === undefined) {
    const hasProcessEnv =
      typeof process !== "undefined" && Boolean(process.env);
    const fromServer = hasProcessEnv
      ? trimmed(process.env.VOLATO_DIST)
      : undefined;
    const fromPublic = hasProcessEnv
      ? trimmed(process.env.NEXT_PUBLIC_VOLATO_DIST)
      : undefined;
    cachedDist = fromServer ?? fromPublic ?? null;
  }
  return cachedDist ?? undefined;
}

/**
 * Apply detected release / commit / environment / dist onto an event payload.
 * Existing explicit values on the event are preserved — auto-detection
 * never overwrites a user-supplied field.
 */
export function applyBuildIdentityTo(event: Record<string, unknown>): void {
  if (!event.release) {
    const r = detectRelease();
    if (r) event.release = r;
  }
  if (!event.commitSha) {
    const sha = detectCommitSha();
    if (sha) event.commitSha = sha;
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
  cachedCommitSha = undefined;
  cachedEnvironment = undefined;
  cachedDist = undefined;
}
