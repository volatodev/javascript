/**
 * Path projection contract — used by both the CLI sourcemap uploader
 * (`@volatodev/cli`) and the Volato source resolver so they pick the
 * same lookup key for the same logical chunk, regardless of how the
 * runtime reports the frame's path.
 *
 * Strategy: extract the hex hash that webpack/Next 15 embeds in the
 * bundled filename (`*-<8 to 20 hex>.js`). The hash is identical
 * across every form the path can take in the wild:
 *
 *   browser default     https://app.example.com/_next/static/chunks/page-abc12345.js
 *   browser basePath    https://app.example.com/myapp/_next/static/chunks/page-abc12345.js
 *   browser CDN prefix  https://cdn.example.com/v3/_next/static/chunks/page-abc12345.js
 *   build-dir relative  .next/static/chunks/page-abc12345.js
 *
 * → all four return `{ filename_hash: "abc12345", display_path:
 *   "static/chunks/page-abc12345.js" }`.
 *
 * If the regex fails (custom build that doesn't hash filenames,
 * `webpack-internal://` frames before pruning, server-side
 * filesystem paths like `/var/task/.next/server/...`), return
 * `null`. The resolver falls through to the existing "Open this"
 * pointer. We do NOT silently invent a key.
 *
 * Server-side maps are out of scope for v0. They lack the
 * hashed-filename convention browsers use; addressing them needs
 * a different lookup scheme.
 */

const FILENAME_HASH_REGEX = /-([a-f0-9]{8,20})\.js(?:\.map)?(?:[?#]|$)/;

export type StorageKey = {
  /**
   * Hex hash extracted from the bundled filename. Stable across
   * `basePath`, `assetPrefix`, CDN rewrites, and the build-dir vs
   * runtime-URL split.
   */
  filename_hash: string;
  /**
   * Best-effort repo-relative pretty path. Used ONLY for the
   * markdown pointer rendered to the agent ("Open this"). Not a
   * lookup key — two different display_paths can resolve to the
   * same `filename_hash` (e.g. URL with vs without `basePath`),
   * which is fine.
   */
  display_path: string;
};

/**
 * Strip protocol+host and any path prefix up to and including the
 * last `_next/` (browser URL) or `.next/` (build-dir). Leaves a
 * `static/chunks/...` (or similar) suffix that converges between
 * the SDK uploader and the resolver.
 */
function simplifyDisplayPath(path: string): string {
  // Strip protocol+host — keep only the URL path portion.
  let p = path.replace(/^https?:\/\/[^/]+/, "");
  // Strip the `?...` / `#...` tail — display only.
  p = p.replace(/[?#].*$/, "");
  // Strip everything up to and including the last `/_next/` (URL).
  p = p.replace(/^.*\/_next\//, "");
  // Strip a leading `.next/` (build-dir relative path).
  p = p.replace(/^\.next\//, "");
  // Strip a leading slash if it survived.
  p = p.replace(/^\/+/, "");
  return p;
}

export function projectFramePath(framePath: string): StorageKey | null {
  if (!framePath || typeof framePath !== "string") return null;

  const match = FILENAME_HASH_REGEX.exec(framePath);
  if (!match || !match[1]) return null;

  return {
    filename_hash: match[1],
    display_path: simplifyDisplayPath(framePath),
  };
}
