export const VOLATO_DSN_HEADER = "X-Volato-DSN";
export const VOLATO_USAGE_WARN_HEADER = "X-Volato-Usage-Warn";
export const VOLATO_REASON_HEADER = "X-Volato-Reason";

export type Runtime =
  | "client"
  | "rsc"
  | "server_action"
  | "route_handler"
  | "middleware";

export type Level = "fatal" | "error" | "warning" | "info" | "debug";

export type User = {
  id?: string;
  email?: string;
  username?: string;
  ip_address?: string;
  segment?: string;
  [key: string]: unknown;
};

export type Breadcrumb = {
  timestamp: number;
  type?: string;
  category?: string;
  level?: Level;
  message?: string;
  data?: Record<string, unknown>;
  [key: string]: unknown;
};

export type LinkedError = {
  type: string;
  message: string;
  stack?: string | null;
  [key: string]: unknown;
};

export type Contexts = Record<string, Record<string, unknown>>;

export type ErrorEvent = {
  v?: 1;
  type: string;
  message: string;
  runtime: Runtime;
  timestamp: number;
  [key: string]: unknown;
};

export type ParsedDSN = {
  origin: string;
  publicKey: string;
  projectId: string;
};

export function parseDSN(dsn: string): ParsedDSN {
  const url = new URL(dsn);
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("Volato DSN protocol must be http or https");
  }
  if (!url.username || url.password) {
    throw new Error("Volato DSN must contain one public key");
  }
  const projectId = url.pathname.replace(/^\/+/, "").replace(/\/+$/, "").trim();
  if (!projectId || projectId.includes("/")) {
    throw new Error("Volato DSN must contain one project id");
  }
  return { origin: url.origin, publicKey: url.username, projectId };
}

export function dsnToIngestUrl(dsn: string | ParsedDSN): string {
  const parsed = typeof dsn === "string" ? parseDSN(dsn) : dsn;
  return `${parsed.origin}/api/ingest`;
}

const FILENAME_HASH_REGEX = /-([a-f0-9]{8,20})\.js(?:\.map)?(?:[?#]|$)/;

export function projectFramePath(
  framePath: string,
): { filename_hash: string; display_path: string } | null {
  const match = FILENAME_HASH_REGEX.exec(framePath);
  if (!match?.[1]) return null;
  let displayPath = framePath.replace(/^https?:\/\/[^/]+/, "");
  displayPath = displayPath.replace(/[?#].*$/, "");
  displayPath = displayPath.replace(/^.*\/_next\//, "");
  displayPath = displayPath.replace(/^\.next\//, "");
  displayPath = displayPath.replace(/^\/+/, "");
  return { filename_hash: match[1], display_path: displayPath };
}
