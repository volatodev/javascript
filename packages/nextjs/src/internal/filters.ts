/**
 * Pre-send filters: ignoreErrors / denyUrls / allowUrls / sampleRate.
 *
 * Order:
 *   1. ignoreErrors (type / message match)
 *   2. denyUrls     (url / filename / stack match)
 *   3. allowUrls    (must match if set)
 *   4. sampleRate   (random gate)
 *
 * Returns `true` to keep the event, `false` to drop. Filters never throw.
 */

export type FilterConfig = {
  ignoreErrors?: ReadonlyArray<string | RegExp>;
  denyUrls?: ReadonlyArray<string | RegExp>;
  allowUrls?: ReadonlyArray<string | RegExp>;
  sampleRate?: number;
};

function matches(haystack: string, pattern: string | RegExp): boolean {
  if (typeof pattern === "string") return haystack.includes(pattern);
  try {
    return pattern.test(haystack);
  } catch {
    return false;
  }
}

function anyMatch(
  haystack: string,
  patterns: ReadonlyArray<string | RegExp>,
): boolean {
  for (const p of patterns) {
    if (matches(haystack, p)) return true;
  }
  return false;
}

function urlSurface(event: Record<string, unknown>): string {
  const parts: string[] = [];
  if (typeof event.url === "string") parts.push(event.url);
  if (typeof event.filename === "string") parts.push(event.filename);
  if (typeof event.stack === "string") parts.push(event.stack);
  return parts.join("\n");
}

function errorSurface(event: Record<string, unknown>): string {
  const t = typeof event.type === "string" ? event.type : "";
  const m = typeof event.message === "string" ? event.message : "";
  return `${t}: ${m}`;
}

export function shouldKeep(
  event: Record<string, unknown>,
  config: FilterConfig,
  random: () => number = Math.random,
): boolean {
  if (config.ignoreErrors && config.ignoreErrors.length > 0) {
    if (anyMatch(errorSurface(event), config.ignoreErrors)) return false;
  }
  if (config.denyUrls && config.denyUrls.length > 0) {
    if (anyMatch(urlSurface(event), config.denyUrls)) return false;
  }
  if (config.allowUrls && config.allowUrls.length > 0) {
    if (!anyMatch(urlSurface(event), config.allowUrls)) return false;
  }
  if (typeof config.sampleRate === "number") {
    const r = config.sampleRate;
    if (r <= 0) return false;
    if (r < 1 && random() >= r) return false;
  }
  return true;
}
