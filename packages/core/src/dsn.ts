export type ParsedDSN = {
  protocol: "http" | "https";
  publicKey: string;
  host: string;
  port?: number;
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
    throw new InvalidDSNError(`protocol must be http or https, got ${url.protocol}`);
  }

  if (!url.username) {
    throw new InvalidDSNError("missing public key (username)");
  }

  const projectId = url.pathname.replace(/^\/+/, "").split("/")[0] ?? "";
  if (!projectId) {
    throw new InvalidDSNError("missing project id (path)");
  }

  return {
    protocol: url.protocol === "https:" ? "https" : "http",
    publicKey: url.username,
    host: url.hostname,
    port: url.port ? Number(url.port) : undefined,
    projectId,
  };
}

export function dsnToIngestUrl(dsn: string | ParsedDSN): string {
  const parsed = typeof dsn === "string" ? parseDSN(dsn) : dsn;
  const port = parsed.port ? `:${parsed.port}` : "";
  return `${parsed.protocol}://${parsed.host}${port}/api/ingest/${parsed.projectId}`;
}
