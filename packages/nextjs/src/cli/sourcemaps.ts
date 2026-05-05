/**
 * `volato sourcemaps purge` — delete sourcemap rows + S3 objects
 * from a Volato project.
 *
 * Token-authed (no DSN — the DSN is in browser bundles and must
 * never grant write access to the upload/delete path). The token
 * comes from the `VOLATO_INGEST_TOKEN` env var or the explicit
 * `--token` flag. Find it in the dashboard project detail page.
 *
 * The endpoint URL is the same host that serves `/api/ingest`. We
 * read it from `VOLATO_INGEST_URL` (or `--endpoint`) — there is no
 * default because Volato runs on customer-controlled hosts; we
 * never silently target `volato.dev`.
 *
 * Optional `--release <sha>` scopes the purge to one release.
 * Without it, every map for the project is removed (the GDPR
 * erasure path).
 *
 * Phase D.1 of the sourcemaps work. The upload command lands in D.3.
 */

export type PurgeOptions = {
  /** Falls back to `VOLATO_INGEST_TOKEN`. */
  token?: string;
  /**
   * Ingest service base URL. Falls back to `VOLATO_INGEST_URL`.
   * Example: `https://api.volato.dev`.
   */
  endpoint?: string;
  /** Optional release tag to narrow the purge. */
  release?: string;
  /** Override the global `fetch` (test-only). */
  fetchImpl?: typeof fetch;
  /** Capture stdout instead of writing to it (test-only). */
  stdout?: (line: string) => void;
};

export type PurgeResult = {
  purged: number;
  scope: string;
};

export async function runPurge(opts: PurgeOptions): Promise<PurgeResult> {
  const token = opts.token ?? process.env.VOLATO_INGEST_TOKEN;
  if (!token) {
    throw new Error(
      "Missing ingest token. Pass --token or set VOLATO_INGEST_TOKEN. " +
        "Find it in your project's dashboard.",
    );
  }

  const endpoint = opts.endpoint ?? process.env.VOLATO_INGEST_URL;
  if (!endpoint) {
    throw new Error(
      "Missing ingest endpoint. Pass --endpoint or set VOLATO_INGEST_URL " +
        "(e.g. https://api.volato.dev).",
    );
  }

  const url = new URL("/api/sourcemaps", endpoint);
  const body = opts.release
    ? JSON.stringify({ release: opts.release })
    : undefined;

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
  };
  if (body) headers["Content-Type"] = "application/json";

  const fetchImpl = opts.fetchImpl ?? fetch;
  const res = await fetchImpl(url, { method: "DELETE", headers, body });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Purge failed: ${res.status} ${text || res.statusText}`.trim(),
    );
  }

  const result = (await res.json()) as PurgeResult;
  const out = opts.stdout ?? ((line: string) => process.stdout.write(line));
  out(`Purged ${result.purged} map(s) from ${result.scope}\n`);
  return result;
}
