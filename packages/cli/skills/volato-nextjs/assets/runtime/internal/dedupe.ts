/**
 * SDK-side deduplication: drop a captured event if we've seen the same
 * `(type, message, first-stack-frame)` triple within the configured TTL.
 *
 * Purpose: a single bug can fire `console.error` 50 times during a render
 * loop or in a `setInterval`. Without dedup, every one becomes a network
 * request — burning the user's quota and ours. The window is short
 * (default 5 s) so genuine new occurrences after a delay still get sent.
 *
 * Bounded memory: keeps at most `MAX_ENTRIES` fingerprints; oldest are
 * evicted FIFO.
 *
 * Cheap: SHA/HMAC unnecessary — a plain string concat keys a Map.
 */

const DEFAULT_TTL_MS = 5_000;
const MAX_ENTRIES = 200;

const lastSeenAt = new Map<string, number>();

function firstFrame(stack: unknown): string {
  if (typeof stack !== "string") return "";
  const lines = stack.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("at ")) return trimmed;
  }
  return lines[0]?.trim() ?? "";
}

function dedupKey(event: Record<string, unknown>): string {
  const t = typeof event.type === "string" ? event.type : "";
  const m = typeof event.message === "string" ? event.message : "";
  return `${t}\x00${m}\x00${firstFrame(event.stack)}`;
}

function evictExpired(now: number, ttlMs: number): void {
  for (const [k, t] of lastSeenAt) {
    if (now - t > ttlMs) lastSeenAt.delete(k);
  }
}

function evictToCapacity(): void {
  while (lastSeenAt.size > MAX_ENTRIES) {
    const oldestKey = lastSeenAt.keys().next().value;
    if (oldestKey === undefined) break;
    lastSeenAt.delete(oldestKey);
  }
}

export type DedupeOptions = {
  /** TTL in ms (default 5000). Set to `0` to disable dedup. */
  ttlMs?: number;
  /** Override the clock (for tests). */
  now?: () => number;
};

/**
 * Returns `true` if the event is new (or last seen outside the TTL) — the
 * caller should send it. Returns `false` for a duplicate within the TTL.
 *
 * Side effect: updates the LRU `lastSeenAt` map for this event's key.
 */
export function shouldSend(
  event: Record<string, unknown>,
  options: DedupeOptions = {},
): boolean {
  const ttl = options.ttlMs ?? DEFAULT_TTL_MS;
  if (ttl <= 0) return true;
  const now = (options.now ?? Date.now)();
  const key = dedupKey(event);
  const last = lastSeenAt.get(key);
  if (last !== undefined && now - last <= ttl) {
    lastSeenAt.set(key, now); // refresh so a hot loop keeps suppressing
    return false;
  }
  lastSeenAt.set(key, now);
  evictExpired(now, ttl);
  evictToCapacity();
  return true;
}

/** Test-only — clear the dedupe map. */
export function __resetDedupeForTests(): void {
  lastSeenAt.clear();
}
