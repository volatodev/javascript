/**
 * Cross-runtime, defensive envelope serialization.
 *
 * Scope extras and beforeSend output are application-controlled. They may
 * contain cycles, throwing getters, BigInts, or arbitrarily deep structures.
 * Capture must never let those values change the host application's behavior.
 */

const DEFAULT_MAX_BYTES = 64 * 1024;
const MAX_DEPTH = 6;
const MAX_PROPERTIES = 50;
const MAX_ARRAY_ITEMS = 50;
const MAX_STRING_CHARS = 8_192;
const FILTERED_VALUE = "[Unserializable]";

export type SerializedEnvelope = {
  body: string;
  truncated: boolean;
};

type State = {
  seen: WeakSet<object>;
  truncated: boolean;
};

function truncateString(value: string, state: State): string {
  if (value.length <= MAX_STRING_CHARS) return value;
  state.truncated = true;
  return `${value.slice(0, MAX_STRING_CHARS)}…[truncated]`;
}

function normalize(value: unknown, depth: number, state: State): unknown {
  if (value === null) return null;
  if (typeof value === "string") return truncateString(value, state);
  if (typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (Number.isFinite(value)) return value;
    state.truncated = true;
    return String(value);
  }
  if (typeof value === "bigint") {
    state.truncated = true;
    return `${value.toString()}n`;
  }
  if (typeof value === "undefined") return undefined;
  if (typeof value === "symbol") {
    state.truncated = true;
    return String(value);
  }
  if (typeof value === "function") {
    state.truncated = true;
    return `[Function${value.name ? ` ${value.name}` : ""}]`;
  }
  if (depth >= MAX_DEPTH) {
    state.truncated = true;
    return "[MaxDepth]";
  }

  const object = value as object;
  if (state.seen.has(object)) {
    state.truncated = true;
    return "[Circular]";
  }
  state.seen.add(object);

  if (value instanceof Date) {
    const time = value.getTime();
    if (Number.isFinite(time)) return value.toISOString();
    state.truncated = true;
    return "Invalid Date";
  }

  if (Array.isArray(value)) {
    const count = Math.min(value.length, MAX_ARRAY_ITEMS);
    if (value.length > count) state.truncated = true;
    const out: unknown[] = [];
    for (let i = 0; i < count; i += 1) {
      let child: unknown;
      try {
        child = value[i];
      } catch {
        state.truncated = true;
        child = FILTERED_VALUE;
      }
      out.push(normalize(child, depth + 1, state) ?? null);
    }
    return out;
  }

  let keys: string[];
  try {
    keys = Object.keys(value as Record<string, unknown>);
  } catch {
    state.truncated = true;
    return FILTERED_VALUE;
  }
  if (keys.length > MAX_PROPERTIES) state.truncated = true;

  const out: Record<string, unknown> = {};
  for (const key of keys.slice(0, MAX_PROPERTIES)) {
    let child: unknown;
    try {
      child = (value as Record<string, unknown>)[key];
    } catch {
      state.truncated = true;
      child = FILTERED_VALUE;
    }
    const normalized = normalize(child, depth + 1, state);
    if (normalized !== undefined) out[key] = normalized;
  }
  return out;
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function reducedEnvelope(
  normalized: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of [
    "v",
    "type",
    "message",
    "runtime",
    "timestamp",
    "stack",
    "url",
    "filename",
    "lineno",
    "colno",
    "route",
    "release",
    "environment",
    "capturedVia",
    "request",
  ]) {
    if (key in normalized) out[key] = normalized[key];
  }
  out.volatoTruncated = true;
  return out;
}

export function serializeEnvelope(
  value: unknown,
  maxBytes = DEFAULT_MAX_BYTES,
): SerializedEnvelope {
  const state: State = { seen: new WeakSet(), truncated: false };
  let normalized = normalize(value, 0, state);
  if (!normalized || typeof normalized !== "object" || Array.isArray(normalized)) {
    normalized = {
      type: "Error",
      message: String(normalized ?? "Unknown error"),
      runtime: "unknown",
      timestamp: Date.now(),
    };
    state.truncated = true;
  }

  const record = normalized as Record<string, unknown>;
  if (state.truncated) record.volatoTruncated = true;
  let body = JSON.stringify(record);
  if (byteLength(body) <= maxBytes) {
    return { body, truncated: state.truncated };
  }

  const reduced = reducedEnvelope(record);
  if (typeof reduced.stack === "string") {
    reduced.stack = reduced.stack.slice(0, Math.min(16_384, maxBytes / 2));
  }
  if (typeof reduced.message === "string") {
    reduced.message = reduced.message.slice(0, Math.min(4_096, maxBytes / 4));
  }
  body = JSON.stringify(reduced);
  if (byteLength(body) <= maxBytes) return { body, truncated: true };

  return {
    body: JSON.stringify({
      type: String(record.type ?? "Error").slice(0, 128),
      message: String(record.message ?? "Event exceeded serialization budget").slice(
        0,
        Math.max(128, Math.min(2_048, maxBytes / 2)),
      ),
      runtime: String(record.runtime ?? "unknown").slice(0, 64),
      timestamp:
        typeof record.timestamp === "number" ? record.timestamp : Date.now(),
      volatoTruncated: true,
    }),
    truncated: true,
  };
}
