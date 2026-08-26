export const VOLATO_DSN_HEADER = "X-Volato-DSN";
export const VOLATO_USAGE_WARN_HEADER = "X-Volato-Usage-Warn";
export const VOLATO_REASON_HEADER = "X-Volato-Reason";

export type Runtime =
  | "client"
  | "rsc"
  | "pages_render"
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

const FILENAME_HASH_REGEX = /-([a-zA-Z0-9_-]{8,20})\.js(?:\.map)?(?:[?#]|$)/;
const TURBOPACK_BROWSER_HASH_REGEX =
  /(?:^|\/)([a-zA-Z0-9_-]{8,64})\.js(?:\.map)?(?:[?#]|$)/;
const NEXT_SERVER_BUILD_PATH_REGEX = /^server\/.+\.[cm]?js(?:\.map)?$/;

function nextServerBuildPath(path: string): string | null {
  let value = path.replace(/^file:\/\//, "").replaceAll("\\", "/");
  value = value.replace(/[?#].*$/, "");
  const marker = value.indexOf("/.next/server/");
  if (marker >= 0) {
    value = value.slice(marker + "/.next/".length);
  } else {
    value = value.replace(/^\.next\//, "");
  }
  value = value.replace(/\.map$/, "");
  return NEXT_SERVER_BUILD_PATH_REGEX.test(value) ? value : null;
}

function stablePathHash(path: string): string {
  // FNV-1a 64 represented as two uint32 words. Avoid BigInt syntax because
  // many Next.js repositories still type-check generated files as ES2017.
  let high = 0xcbf29ce4;
  let low = 0x84222325;
  for (const character of path) {
    low = (low ^ (character.codePointAt(0) ?? 0)) >>> 0;
    const lowProduct = low * 0x1b3;
    high =
      (high * 0x1b3 + low * 0x100 + Math.floor(lowProduct / 0x1_0000_0000)) >>>
      0;
    low = lowProduct >>> 0;
  }
  const hex = `${high.toString(16).padStart(8, "0")}${low
    .toString(16)
    .padStart(8, "0")}`;
  return `p${hex.slice(-15)}`;
}

export function projectFramePath(
  framePath: string,
): { filename_hash: string; display_path: string } | null {
  const match = FILENAME_HASH_REGEX.exec(framePath);
  if (!match?.[1]) {
    const displayPath = nextServerBuildPath(framePath);
    if (displayPath) {
      return {
        filename_hash: stablePathHash(displayPath),
        display_path: displayPath,
      };
    }
  }
  const filenameHash =
    match?.[1] ?? TURBOPACK_BROWSER_HASH_REGEX.exec(framePath)?.[1];
  if (!filenameHash) return null;
  let displayPath = framePath.replace(/^https?:\/\/[^/]+/, "");
  displayPath = displayPath.replace(/[?#].*$/, "");
  displayPath = displayPath.replace(/^.*\/_next\//, "");
  displayPath = displayPath.replace(/^\.next\//, "");
  displayPath = displayPath.replace(/^\/+/, "");
  displayPath = displayPath.replace(/\.map$/, "");
  return { filename_hash: filenameHash, display_path: displayPath };
}
