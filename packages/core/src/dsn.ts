export type ParsedDSN = {
  origin: string;
  secret: string;
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

  const secret = url.pathname.replace(/^\/+/, "").trim();
  if (!secret) {
    throw new InvalidDSNError("missing secret in DSN path");
  }

  return {
    origin: url.origin,
    secret,
  };
}

export function dsnToIngestUrl(dsn: string | ParsedDSN): string {
  const parsed = typeof dsn === "string" ? parseDSN(dsn) : dsn;
  return `${parsed.origin}/api/ingest`;
}

export function dsnSecret(dsn: string): string | null {
  try {
    return parseDSN(dsn).secret;
  } catch {
    return null;
  }
}
