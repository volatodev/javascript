/**
 * Thin HTTP client for the Volato agent API.
 *
 * Every command goes through one of `getJson` / `postJson`. They both:
 *   - resolve the API base URL (env override, then default)
 *   - read the bearer token from the credentials file
 *   - attach `Authorization: Bearer <token>`
 *   - decode the JSON envelope `{ markdown, data }` returned by the
 *     API, or the error envelope `{ error, message? }`
 *
 * The API returns a JSON envelope on success AND on error. We don't
 * try to be clever about transport-level failures (DNS, timeout) —
 * those bubble as thrown errors that the CLI entry catches and
 * prints to stderr.
 */
import { readToken } from "./credentials.js";

const DEFAULT_API_URL = "https://api.volato.dev";

export type ApiResponse<T = unknown> = {
  status: number;
  ok: boolean;
  markdown?: string;
  data?: T;
  error?: string;
  message?: string;
};

function resolveApiBase(): string {
  const raw = process.env.VOLATO_API_URL ?? DEFAULT_API_URL;
  return raw.replace(/\/+$/, "");
}

async function loadToken(): Promise<string> {
  const token = await readToken();
  if (!token) {
    throw new CliError(
      "Not authenticated. Run `volato login <token>` first — grab the token from https://app.volato.dev (workspace home).",
    );
  }
  return token;
}

async function request<T>(
  method: "GET" | "POST",
  path: string,
  body?: unknown,
): Promise<ApiResponse<T>> {
  const token = await loadToken();
  const url = `${resolveApiBase()}${path}`;
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  let parsed: unknown = {};
  const text = await res.text();
  if (text.length > 0) {
    try {
      parsed = JSON.parse(text);
    } catch {
      // Non-JSON body — keep the raw text so the CLI can surface it.
      parsed = { error: "non_json_response", message: text };
    }
  }
  const envelope = parsed as Record<string, unknown>;

  return {
    status: res.status,
    ok: res.ok,
    markdown: typeof envelope.markdown === "string" ? envelope.markdown : undefined,
    data: envelope.data as T | undefined,
    error: typeof envelope.error === "string" ? envelope.error : undefined,
    message: typeof envelope.message === "string" ? envelope.message : undefined,
  };
}

export function getJson<T = unknown>(
  path: string,
  query?: Record<string, string | number | undefined>,
): Promise<ApiResponse<T>> {
  const params = new URLSearchParams();
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined) params.append(k, String(v));
    }
  }
  const qs = params.toString().length > 0 ? `?${params.toString()}` : "";
  return request<T>("GET", `${path}${qs}`);
}

export function postJson<T = unknown>(
  path: string,
  body: unknown,
): Promise<ApiResponse<T>> {
  return request<T>("POST", path, body);
}

export class CliError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CliError";
  }
}
