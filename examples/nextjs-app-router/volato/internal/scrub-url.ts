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

const SENSITIVE_PATH_LABELS = new Set([
  "activate",
  "activation",
  "invite",
  "invitation",
  "magic",
  "reset",
  "verify",
  "verification",
]);

export function isSensitiveParamName(name: string): boolean {
  const lower = name.toLowerCase();
  for (const f of SENSITIVE_FRAGMENTS) {
    if (lower.includes(f)) return true;
  }
  return false;
}

export function scrubUrl(url: string): string {
  const hashIndex = url.indexOf("#");
  const beforeHash = hashIndex === -1 ? url : url.slice(0, hashIndex);
  const fragment = hashIndex === -1 ? "" : url.slice(hashIndex);
  const q = beforeHash.indexOf("?");
  const rawPath = q === -1 ? beforeHash : beforeHash.slice(0, q);
  const path = scrubPath(rawPath);
  const pathChanged = path !== rawPath;
  if (q === -1) return `${path}${fragment}`;

  const queryStr = beforeHash.slice(q + 1);

  if (!queryStr) return `${path}?${fragment}`;

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
  if (!changed && !pathChanged) return url;
  return `${path}?${parts.join("&")}${fragment}`;
}

/**
 * Redact the segment following an explicit credential-bearing route label.
 * Opaque IDs on ordinary resource routes stay visible: `/users/<uuid>` is
 * useful debugging context, while `/reset/<token>` is not.
 */
export function scrubPath(path: string): string {
  const absolute = /^([a-z][a-z0-9+.-]*:\/\/[^/]+)(\/.*)?$/i.exec(path);
  const prefix = absolute?.[1] ?? "";
  const pathname = absolute ? absolute[2] ?? "/" : path;
  const segments = pathname.split("/");
  let changed = false;

  for (let i = 0; i < segments.length - 1; i += 1) {
    let decoded = segments[i] ?? "";
    try {
      decoded = decodeURIComponent(decoded);
    } catch {
      // Keep the raw segment for matching when percent-decoding fails.
    }
    const label = decoded.toLowerCase();
    if (
      SENSITIVE_PATH_LABELS.has(label) ||
      isSensitiveParamName(label)
    ) {
      if (segments[i + 1] && segments[i + 1] !== FILTERED) {
        segments[i + 1] = FILTERED;
        changed = true;
      }
    }
  }

  return changed ? `${prefix}${segments.join("/")}` : path;
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
