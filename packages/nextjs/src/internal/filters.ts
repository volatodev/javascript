/**
 * Pre-send filter: ignoreErrors only.
 *
 * Returns `true` to keep the event, `false` to drop. Never throws.
 *
 * Sampling, allowUrls, denyUrls were removed in the post-audit cuts:
 * sampling is a server-side decision (pricing commits to it), and
 * allow/denyUrls is dashboard-culture noise. ignoreErrors is the only
 * legitimate client-side filter — silencing well-known third-party
 * messages.
 */

export type FilterConfig = {
  ignoreErrors?: ReadonlyArray<string | RegExp>;
};

function matches(haystack: string, pattern: string | RegExp): boolean {
  if (typeof pattern === "string") return haystack.includes(pattern);
  try {
    return pattern.test(haystack);
  } catch {
    return false;
  }
}

function errorSurface(event: Record<string, unknown>): string {
  const t = typeof event.type === "string" ? event.type : "";
  const m = typeof event.message === "string" ? event.message : "";
  return `${t}: ${m}`;
}

export function shouldKeep(
  event: Record<string, unknown>,
  config: FilterConfig,
): boolean {
  const patterns = config.ignoreErrors;
  if (!patterns || patterns.length === 0) return true;
  const surface = errorSurface(event);
  for (const p of patterns) {
    if (matches(surface, p)) return false;
  }
  return true;
}
