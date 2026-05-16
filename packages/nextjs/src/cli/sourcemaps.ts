/**
 * `volato sourcemaps purge` — delete sourcemap rows + S3 objects
 * from a Volato project.
 *
 * Token-authed (no DSN — the DSN is in browser bundles and must
 * never grant write access to the upload/delete path). The token
 * comes from the `VOLATO_INGEST_TOKEN` env var or the explicit
 * `--token` flag. Find it in the dashboard project detail page.
 *
 * The endpoint host is derived from `NEXT_PUBLIC_VOLATO_DSN` — the
 * DSN already encodes the ingest origin, so there is no second URL
 * env var to maintain. Pass `--endpoint` to override.
 *
 * Optional `--release <sha>` scopes the purge to one release.
 * Without it, every map for the project is removed (the GDPR
 * erasure path).
 *
 * Phase D.1 of the sourcemaps work. The upload command lands in D.3.
 */

import { parseDSN } from "@volatodev/core";

export type PurgeOptions = {
  /** Falls back to `VOLATO_INGEST_TOKEN`. */
  token?: string;
  /**
   * Ingest service base URL. When omitted, derived from
   * `NEXT_PUBLIC_VOLATO_DSN` (same host the SDK ships events to).
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

function deriveEndpointFromDsn(): string | undefined {
  const dsn = process.env.NEXT_PUBLIC_VOLATO_DSN;
  if (!dsn) return undefined;
  try {
    return parseDSN(dsn).origin;
  } catch {
    return undefined;
  }
}

export async function runPurge(opts: PurgeOptions): Promise<PurgeResult> {
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
