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
 * The API returns a JSON envelope on success AND on error. Transport
 * resilience is bounded and deliberate:
 *   - every request carries a 30s timeout (AbortSignal) so a hung
 *     connection can't stall an agent waiting on the CLI;
 *   - transient failures (network errors, 502/503/504) get up to 2
 *     quick retries with exponential backoff;
 *   - 429 is NOT auto-retried — its Retry-After can be a full minute,
 *     and sleeping that long in a one-shot CLI is worse than returning
 *     the 429 and letting the caller decide. We surface `retryAfter`.
 * A fatal transport failure bubbles as a CliError the entry catches.
 */
import { readToken } from "./credentials.js";
import { EXIT } from "./exit.js";

const DEFAULT_API_URL = "https://api.volato.dev";
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_ATTEMPTS = 3;
const RETRYABLE_STATUS = new Set([502, 503, 504]);

export type ApiResponse<T = unknown> = {
  status: number;
  ok: boolean;
  markdown?: string;
  data?: T;
  error?: string;
  message?: string;
  /** Seconds from a `Retry-After` header (429/503), when present. */
  retryAfter?: number;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Exponential backoff for transient retries: 250ms, then 500ms (cap 2s).
function backoffMs(attempt: number): number {
  return Math.min(250 * 2 ** (attempt - 1), 2000);
}

function parseRetryAfter(raw: string | null): number | undefined {
  if (!raw || !/^\d+$/.test(raw)) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

export function resolveApiBase(): string {
  const raw = process.env.VOLATO_API_URL ?? DEFAULT_API_URL;
  return raw.replace(/\/+$/, "");
}

export async function loadToken(): Promise<string> {
  // An explicit environment credential wins so CI can override a stale token
  // left on a persistent runner. Interactive use falls back to the local file.
  const token = process.env.VOLATO_TOKEN?.trim() || (await readToken());
  if (!token) {
    throw new CliError(
      "Not authenticated. Run `volato login`, or set VOLATO_TOKEN in the environment.",
      EXIT.AUTH,
    );
  }
  return token;
}

async function request<T>(
  method: "GET" | "POST",
  path: string,
  body?: unknown,
  opts?: { auth?: boolean; idempotencyKey?: string },
): Promise<ApiResponse<T>> {
  const url = `${resolveApiBase()}${path}`;
  const headers: Record<string, string> = {
    ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
  };
  // The login exchange is pre-auth (the caller has no token yet); every
  // other call attaches the bearer.
  if (opts?.auth !== false) {
    headers.Authorization = `Bearer ${await loadToken()}`;
  }
  if (opts?.idempotencyKey) {
    headers["Idempotency-Key"] = opts.idempotencyKey;
  }
  const payload = body !== undefined ? JSON.stringify(body) : undefined;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    let res: Response;
    try {
      res = await fetch(url, {
        method,
        headers,
        body: payload,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      // Transport failure (DNS, reset) or our own timeout. Retry the
      // transient ones; once attempts run out, surface a clean message.
      if (attempt < MAX_ATTEMPTS) {
        await sleep(backoffMs(attempt));
        continue;
      }
      const timedOut = err instanceof Error && err.name === "TimeoutError";
      throw new CliError(
        timedOut
          ? `Request timed out after ${REQUEST_TIMEOUT_MS / 1000}s — ${resolveApiBase()} did not respond.`
          : `Could not reach ${resolveApiBase()}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    // Server-transient statuses get a quick retry; 429 deliberately
    // falls through to be returned (see the module doc comment).
    if (RETRYABLE_STATUS.has(res.status) && attempt < MAX_ATTEMPTS) {
      await sleep(backoffMs(attempt));
      continue;
    }

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
      retryAfter: parseRetryAfter(res.headers.get("retry-after")),
    };
  }

  // Unreachable: the loop returns or throws within MAX_ATTEMPTS. Present
  // so TS sees a definite return on every path.
  throw new CliError("request: exhausted attempts without a response");
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
  options?: { idempotencyKey?: string },
): Promise<ApiResponse<T>> {
  return request<T>("POST", path, body, options);
}

/**
 * POST without a bearer — only for the login code exchange, where the
 * caller has no token yet and the code in the body is the credential.
 */
export function postJsonPublic<T = unknown>(
  path: string,
  body: unknown,
): Promise<ApiResponse<T>> {
  return request<T>("POST", path, body, { auth: false });
}

export class CliError extends Error {
  readonly exitCode: number;
  constructor(message: string, exitCode: number = EXIT.GENERAL) {
    super(message);
    this.name = "CliError";
    this.exitCode = exitCode;
  }
}
