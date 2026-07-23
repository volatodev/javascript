/**
 * Run a user-supplied `beforeSend` hook on an event payload.
 *
 * Contract:
 *   - hook returns the event (possibly mutated) → use the returned value
 *   - hook returns `null` → caller drops the event
 *   - hook throws → swallow, return original event, log a one-shot warning
 *
 * The host app must never crash because of a buggy hook. We trade a single
 * lost event filter pass for survival.
 */

let warned = false;

export function runBeforeSend<T extends Record<string, unknown>>(
  hook: ((event: T) => T | null) | undefined,
  event: T,
): T | null {
  if (!hook) return event;
  try {
    const result = hook(event);
    if (result === null) return null;
    if (result && typeof result === "object") return result;
    return event;
  } catch (err) {
    if (!warned && typeof console !== "undefined" && console.warn) {
      warned = true;
      console.warn(
        "[Volato] beforeSend threw; event passed through unchanged",
        err,
      );
    }
    return event;
  }
}

/** Test-only — re-arm the warn-once latch. */
export function __resetBeforeSendWarningForTests(): void {
  warned = false;
}
