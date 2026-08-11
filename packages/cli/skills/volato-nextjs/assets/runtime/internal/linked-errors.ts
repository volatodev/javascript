/**
 * Walk an error's `cause` chain (ES2022 `new Error("msg", { cause })`) and
 * return a flat array of the linked errors, top-most first. The root error
 * itself is NOT included — the caller already serialised it as the event's
 * top-level `type`/`message`/`stack`.
 *
 * Capped at 5 to avoid cycles or pathological chains. Cycle detection via
 * an identity Set on `Error` instances; non-Error causes are coerced to a
 * minimal `{ type, message }`.
 */
import type { LinkedError } from "../protocol";

const MAX_DEPTH = 5;

function coerceCause(cause: unknown): LinkedError {
  if (cause instanceof Error) {
    return {
      type: cause.constructor.name || cause.name || "Error",
      message: cause.message,
      stack: cause.stack ?? null,
    };
  }
  if (typeof cause === "string") {
    return { type: "Error", message: cause, stack: null };
  }
  if (cause === null || cause === undefined) {
    return {
      type: "Error",
      message: cause === null ? "cause was null" : "cause was undefined",
      stack: null,
    };
  }
  if (typeof cause === "object") {
    const o = cause as Record<string, unknown>;
    const message = typeof o.message === "string" ? o.message : "";
    const name = typeof o.name === "string" ? o.name : "";
    const stack = typeof o.stack === "string" ? o.stack : null;
    if (message || name || stack) {
      return { type: name || "Error", message: message || "Unknown", stack };
    }
    return {
      type: "Error",
      message: "Cause was a non-Error object",
      stack: null,
    };
  }
  return {
    type: "Error",
    message: `Cause was a non-Error ${typeof cause}`,
    stack: null,
  };
}

export function unwrapCauseChain(root: unknown): LinkedError[] {
  if (!(root instanceof Error)) return [];
  const out: LinkedError[] = [];
  const seen = new Set<unknown>([root]);
  let cursor: unknown = (root as { cause?: unknown }).cause;
  while (cursor !== undefined && out.length < MAX_DEPTH) {
    if (seen.has(cursor)) break;
    seen.add(cursor);
    out.push(coerceCause(cursor));
    cursor = (cursor as { cause?: unknown })?.cause;
  }
  return out;
}
