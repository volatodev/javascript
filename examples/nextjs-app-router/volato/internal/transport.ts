/**
 * Resilient ingest transport.
 *
 * - Retries 5xx and 429 with exponential backoff + jitter (default 3 tries).
 * - Honours `Retry-After` (delta-seconds or HTTP-date) on 429 responses.
 * - Surfaces `X-Volato-Usage-Warn` and `X-Volato-Reason` once each via
 *   console.warn — repeated headers don't spam.
 * - Refuses new sends past `MAX_INFLIGHT` so a stalled network never
 *   fills the heap with pending requests.
 * - Drops are reported once via `console.warn` (one-shot per page load,
 *   per drop-class: network, server_5xx, rate_limited). Painkiller
 *   contract: never silent drops — the dev sees the first failure and
 *   can react before the bug list goes dark.
 * - Never throws to the caller. The host app must not crash on a
 *   transport failure; warnings are non-fatal.
 *
 * Caller chooses whether to await the returned Promise. Browser-side
 * fire-and-forget paths just `void sendEnvelope(...)`.
 */

import {
  VOLATO_REASON_HEADER,
  VOLATO_USAGE_WARN_HEADER,
} from "../protocol";

const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_BASE_BACKOFF_MS = 250;
const DEFAULT_ATTEMPT_TIMEOUT_MS = 1_500;
const DEFAULT_TOTAL_TIMEOUT_MS = 5_000;
const MAX_BACKOFF_MS = 30_000;
const MAX_INFLIGHT = 50;

let inflight = 0;
let warnedInflight = false;
let warnedUsage = false;
let warnedReason: string | null = null;
const warnedDrops = new Set<DropReason>();

type DropReason =
  | "network"
  | "timeout"
  | "server_5xx"
  | "rate_limited"
  | "client_4xx";

function warnDropOnce(reason: DropReason, status?: number): void {
  if (warnedDrops.has(reason)) return;
  warnedDrops.add(reason);
  if (typeof console !== "undefined" && console.warn) {
    const detail =
      reason === "server_5xx"
        ? `ingest returned ${status ?? "5xx"} after retries`
        : reason === "rate_limited"
          ? "ingest 429 after retries"
          : reason === "client_4xx"
            ? `ingest rejected the event with ${status ?? "4xx"}`
            : reason === "timeout"
              ? "transport deadline exceeded"
          : "network failure after retries";
    console.warn(
      `[Volato] Event dropped: ${detail}. Subsequent drops are silent until the page reloads.`,
    );
  }
}

export type SendOptions = {
  keepalive?: boolean;
  maxRetries?: number;
  baseBackoffMs?: number;
  /** Per-attempt network deadline. Default: 1500 ms. */
  timeoutMs?: number;
  /** Whole send budget, including retries/backoff. Default: 5000 ms. */
  maxElapsedMs?: number;
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
 * failures. Resolves to whether ingest accepted the envelope. Never rejects.
 */
export async function sendEnvelope(
  url: string,
  headers: Record<string, string>,
  body: string,
  opts: SendOptions = {},
): Promise<boolean> {
  if (typeof fetch === "undefined") return false;
  if (inflight >= MAX_INFLIGHT) {
    if (!warnedInflight && typeof console !== "undefined" && console.warn) {
      warnedInflight = true;
      console.warn(
        `[Volato] Backpressure: ${MAX_INFLIGHT} ingest requests in flight, dropping new events. Likely a hot loop or a stalled network. Subsequent drops are silent.`,
      );
    }
    return false;
  }

  const maxRetries = opts.maxRetries ?? DEFAULT_MAX_RETRIES;
  const base = opts.baseBackoffMs ?? DEFAULT_BASE_BACKOFF_MS;
  const sleep = opts.sleep ?? defaultSleep;
  const random = opts.random ?? Math.random;
  const now = opts.now ?? Date.now;
  const timeoutMs = Math.max(1, opts.timeoutMs ?? DEFAULT_ATTEMPT_TIMEOUT_MS);
  const maxElapsedMs = Math.max(
    timeoutMs,
    opts.maxElapsedMs ?? DEFAULT_TOTAL_TIMEOUT_MS,
  );
  const deadline = now() + maxElapsedMs;
  const waitWithinBudget = async (delayMs: number): Promise<boolean> => {
    const remaining = deadline - now();
    if (remaining <= 0) return false;
    await sleep(Math.min(delayMs, remaining));
    return delayMs <= remaining;
  };

  inflight += 1;
  try {
    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      const remaining = deadline - now();
      if (remaining <= 0) {
        warnDropOnce("timeout");
        return false;
      }
      let res: Response | null = null;
      let timedOut = false;
      const controller = new AbortController();
      const timer = setTimeout(
        () => {
          timedOut = true;
          controller.abort();
        },
        Math.min(timeoutMs, remaining),
      );
      try {
        const init: RequestInit = {
          method: "POST",
          body,
          headers: { "Content-Type": "application/json", ...headers },
          signal: controller.signal,
        };
        if (opts.keepalive) init.keepalive = true;
        res = await fetch(url, init);
      } catch {
        // network-level failure — retry until exhausted
      } finally {
        clearTimeout(timer);
      }

      if (res) {
        noteServerHeaders(res);
        if (res.status >= 200 && res.status < 300) return true;
        if (res.status === 429) {
          const ra = parseRetryAfter(res.headers.get("Retry-After"), now());
          if (ra !== null && attempt < maxRetries) {
            if (!(await waitWithinBudget(ra))) {
              warnDropOnce("timeout");
              return false;
            }
            continue;
          }
          if (attempt < maxRetries) {
            if (
              !(await waitWithinBudget(backoffMs(attempt, base, random)))
            ) {
              warnDropOnce("timeout");
              return false;
            }
            continue;
          }
          warnDropOnce("rate_limited", res.status);
          return false;
        }
        if (res.status >= 500 && res.status < 600) {
          if (attempt < maxRetries) {
            if (
              !(await waitWithinBudget(backoffMs(attempt, base, random)))
            ) {
              warnDropOnce("timeout");
              return false;
            }
            continue;
          }
          warnDropOnce("server_5xx", res.status);
          return false;
        }
        // 4xx other than 429 are terminal and must still be visible even when
        // a proxy stripped the explanatory X-Volato-Reason header.
        warnDropOnce("client_4xx", res.status);
        return false;
      }

      // network failure
      if (attempt < maxRetries) {
        if (!(await waitWithinBudget(backoffMs(attempt, base, random)))) {
          warnDropOnce("timeout");
          return false;
        }
        continue;
      }
      warnDropOnce(timedOut ? "timeout" : "network");
      return false;
    }
  } finally {
    inflight = Math.max(0, inflight - 1);
  }
  return false;
}

/** Test-only — reset transport counters/warnings between tests. */
export function __resetTransportForTests(): void {
  inflight = 0;
  warnedInflight = false;
  warnedUsage = false;
  warnedReason = null;
  warnedDrops.clear();
}
