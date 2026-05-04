/**
 * Resilient ingest transport.
 *
 * - Retries 5xx and 429 with exponential backoff + jitter (default 3 tries).
 * - Honours `Retry-After` (delta-seconds or HTTP-date) on 429 responses.
 * - Surfaces `X-Volato-Usage-Warn` and `X-Volato-Reason` once each via
 *   console.warn — repeated headers don't spam.
 * - Refuses new sends past `MAX_INFLIGHT` so a stalled network never
 *   fills the heap with pending requests.
 * - Never throws to the caller. Errors are swallowed; the host app must
 *   not crash on a transport failure.
 *
 * Caller chooses whether to await the returned Promise. Browser-side
 * fire-and-forget paths just `void sendEnvelope(...)`.
 */

import {
  VOLATO_REASON_HEADER,
  VOLATO_USAGE_WARN_HEADER,
} from "@volatodev/core";

const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_BASE_BACKOFF_MS = 250;
const MAX_BACKOFF_MS = 30_000;
const MAX_INFLIGHT = 50;

let inflight = 0;
let warnedInflight = false;
let warnedUsage = false;
let warnedReason: string | null = null;

export type SendOptions = {
  keepalive?: boolean;
  maxRetries?: number;
  baseBackoffMs?: number;
  /** Override the clock (for tests). */
  now?: () => number;
  /** Override the random source (for tests — jitter is otherwise Math.random). */
  random?: () => number;
  /** Wait helper, override for tests to skip the actual delay. */
  sleep?: (ms: number) => Promise<void>;
};

function defaultSleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function parseRetryAfter(value: string | null, now: number): number | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (/^\d+(\.\d+)?$/.test(trimmed)) {
    const seconds = Number.parseFloat(trimmed);
    return Number.isFinite(seconds) ? Math.max(0, seconds * 1000) : null;
  }
  const ts = Date.parse(trimmed);
  if (Number.isNaN(ts)) return null;
  return Math.max(0, ts - now);
}

function backoffMs(attempt: number, base: number, random: () => number): number {
  const exp = Math.min(MAX_BACKOFF_MS, base * 2 ** attempt);
  const jitter = exp * (0.5 + random() * 0.5); // 50–100% of exp
  return Math.floor(jitter);
}

function noteServerHeaders(res: Response): void {
  if (!warnedUsage && res.headers.get(VOLATO_USAGE_WARN_HEADER)) {
    warnedUsage = true;
    if (typeof console !== "undefined" && console.warn) {
      console.warn(
        "[Volato] Project quota soft-warn (≥100% of plan). Consider upgrading.",
      );
    }
  }
  const reason = res.headers.get(VOLATO_REASON_HEADER);
  if (reason && reason !== warnedReason) {
    warnedReason = reason;
    if (typeof console !== "undefined" && console.warn) {
      console.warn(`[Volato] Server reason: ${reason}`);
    }
  }
}

/**
 * POST `body` to `url` with the supplied headers, retrying on transient
 * failures. Resolves when the request is complete (success, fatal failure,
 * or retries exhausted). Never rejects.
 */
export async function sendEnvelope(
  url: string,
  headers: Record<string, string>,
  body: string,
  opts: SendOptions = {},
): Promise<void> {
  if (typeof fetch === "undefined") return;
  if (inflight >= MAX_INFLIGHT) {
    if (!warnedInflight && typeof console !== "undefined" && console.warn) {
      warnedInflight = true;
      console.warn(
        `[Volato] Backpressure: ${MAX_INFLIGHT} ingest requests in flight, dropping new events. Likely a hot loop or a stalled network. Subsequent drops are silent.`,
      );
    }
    return;
  }

  const maxRetries = opts.maxRetries ?? DEFAULT_MAX_RETRIES;
  const base = opts.baseBackoffMs ?? DEFAULT_BASE_BACKOFF_MS;
  const sleep = opts.sleep ?? defaultSleep;
  const random = opts.random ?? Math.random;
  const now = opts.now ?? Date.now;

  inflight += 1;
  try {
    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      let res: Response | null = null;
      try {
        const init: RequestInit = {
          method: "POST",
          body,
          headers: { "Content-Type": "application/json", ...headers },
        };
        if (opts.keepalive) init.keepalive = true;
        res = await fetch(url, init);
      } catch {
        // network-level failure — retry until exhausted
      }

      if (res) {
        noteServerHeaders(res);
        if (res.status >= 200 && res.status < 300) return;
        if (res.status === 429) {
          const ra = parseRetryAfter(res.headers.get("Retry-After"), now());
          if (ra !== null && attempt < maxRetries) {
            await sleep(ra);
            continue;
          }
          if (attempt < maxRetries) {
            await sleep(backoffMs(attempt, base, random));
            continue;
          }
          return;
        }
        if (res.status >= 500 && res.status < 600) {
          if (attempt < maxRetries) {
            await sleep(backoffMs(attempt, base, random));
            continue;
          }
          return;
        }
        // 4xx other than 429 — don't retry, drop.
        return;
      }

      // network failure
      if (attempt < maxRetries) {
        await sleep(backoffMs(attempt, base, random));
        continue;
      }
      return;
    }
  } finally {
    inflight = Math.max(0, inflight - 1);
  }
}

/** Test-only — reset transport counters/warnings between tests. */
export function __resetTransportForTests(): void {
  inflight = 0;
  warnedInflight = false;
  warnedUsage = false;
  warnedReason = null;
}
