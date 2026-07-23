/**
 * Redact sensitive query-string parameters in a URL before it lands in
 * a breadcrumb. Pure function, no allocations on the no-match path.
 *
 * Matching is substring + case-insensitive against the decoded parameter
 * name, against a deliberately tight set of fragments. Substring catches
 * `userEmail` / `accessToken` / `apiKey` as written by Next.js devs;
 * the fragments themselves are chosen to keep false positives rare
 * (no standalone `key` — it would scrub `monkey`; no standalone `auth`
 * — it would scrub `author`).
 *
 * Returns the URL unchanged when no sensitive param matches, so the
 * scrubber is cheap on the hot path.
 */

const FILTERED = "[FILTERED]";

const SENSITIVE_FRAGMENTS: readonly string[] = [
  "password",
  "passwd",
  "pwd",
  "token",
  "jwt",
  "secret",
  "authorization",
  "bearer",
  "session",
  "sessid",
  "apikey",
  "api_key",
  "api-key",
  "email",
];

export function isSensitiveParamName(name: string): boolean {
  const lower = name.toLowerCase();
  for (const f of SENSITIVE_FRAGMENTS) {
    if (lower.includes(f)) return true;
  }
  return false;
}

export function scrubUrl(url: string): string {
  const q = url.indexOf("?");
  if (q === -1) return url;

  const path = url.slice(0, q);
  const rest = url.slice(q + 1);
  const hashIdx = rest.indexOf("#");
  const queryStr = hashIdx === -1 ? rest : rest.slice(0, hashIdx);
  const fragment = hashIdx === -1 ? "" : rest.slice(hashIdx);

  if (!queryStr) return url;

  const parts = queryStr.split("&");
  let changed = false;
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]!;
    const eq = part.indexOf("=");
    const rawName = eq === -1 ? part : part.slice(0, eq);
    let decodedName: string;
    try {
      decodedName = decodeURIComponent(rawName);
    } catch {
      decodedName = rawName;
    }
    if (isSensitiveParamName(decodedName)) {
      parts[i] = `${rawName}=${FILTERED}`;
      changed = true;
    }
  }
  if (!changed) return url;
  return `${path}?${parts.join("&")}${fragment}`;
}

/**
 * Scrub a parsed search-params record (the shape stored in
 * `request.searchParams` by the server and middleware capture paths).
 * Returns a new object when any key was sensitive, the same reference
 * otherwise — same allocation-light contract as `scrubUrl`.
 */
export function scrubSearchParams<T extends string | readonly string[]>(
  params: Readonly<Record<string, T>>,
): Record<string, T> {
  let out: Record<string, T> | null = null;
  for (const key of Object.keys(params)) {
    if (isSensitiveParamName(key)) {
      if (!out) out = { ...params };
      const original = params[key]!;
      out[key] = (
        Array.isArray(original)
          ? original.map(() => FILTERED)
          : FILTERED
      ) as T;
    }
  }
  return out ?? (params as Record<string, T>);
}
