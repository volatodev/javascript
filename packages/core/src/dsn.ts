/**
 * DSN parser. Lives in `@volatodev/core` (rather than per-SDK)
 * because both the SDK (constructs the auth header from a DSN)
 * and the platform (validates incoming DSNs before resolving a
 * project row) must agree byte-for-byte on the format.
 *
 * DSN shape: `https://<publicKey>@<host>[:<port>]/<projectId>`.
 *
 * The `publicKey` is the auth secret sent in the `X-Volato-DSN`
 * header. The `projectId` is the UUID of the target project —
 * it lets ingest route the event without an extra DB lookup.
 * Both must be present.
 */
export type ParsedDSN = {
  origin: string;
  publicKey: string;
  projectId: string;
};

export class InvalidDSNError extends Error {
  constructor(message: string) {
    super(`Invalid Volato DSN: ${message}`);
    this.name = "InvalidDSNError";
  }
}

export function parseDSN(dsn: string): ParsedDSN {
  let url: URL;
  try {
    url = new URL(dsn);
  } catch {
    throw new InvalidDSNError(`not a valid URL: ${dsn}`);
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new InvalidDSNError(
      `protocol must be http or https, got ${url.protocol}`,
    );
  }

  const publicKey = url.username;
  if (!publicKey) {
    throw new InvalidDSNError(
      "missing public key — expected https://<publicKey>@host/<projectId>",
    );
  }
  if (url.password) {
    throw new InvalidDSNError(
      "password segment is not allowed — DSN carries only a public key",
    );
  }

  const projectId = url.pathname.replace(/^\/+/, "").replace(/\/+$/, "").trim();
  if (!projectId) {
    throw new InvalidDSNError(
      "missing projectId — expected https://<publicKey>@host/<projectId>",
    );
  }
  if (projectId.includes("/")) {
    throw new InvalidDSNError(
      `projectId must be a single path segment, got "${projectId}"`,
    );
  }

  return {
    origin: url.origin,
    publicKey,
    projectId,
  };
}

export function dsnToIngestUrl(dsn: string | ParsedDSN): string {
  const parsed = typeof dsn === "string" ? parseDSN(dsn) : dsn;
  return `${parsed.origin}/api/ingest`;
}

export function dsnPublicKey(dsn: string): string | null {
  try {
    return parseDSN(dsn).publicKey;
  } catch {
    return null;
  }
}

export function dsnProjectId(dsn: string): string | null {
  try {
    return parseDSN(dsn).projectId;
  } catch {
    return null;
  }
}
