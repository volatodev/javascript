/**
 * Server / Edge hub — AsyncLocalStorage-based isolation.
 *
 * Two requests handled in parallel must not see each other's `setUser` /
 * `setTag` calls. ALS gives us per-request scope isolation: each request
 * runs inside its own `als.run(scope, ...)` frame, and `getCurrentScope()`
 * returns the scope bound to the current async stack.
 *
 * `node:async_hooks` is supported in both Node and the Next.js Edge
 * runtime (since Next 13.4 — Vercel docs explicitly list it).
 *
 * `rootScope` is the fallback used when no ALS frame is active (e.g. a
 * cold-path top-level capture). It is intentionally process-global, but
 * any code that wants isolation should wrap itself in `withScope` or
 * `runWithScope`.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { Scope } from "./scope";

const als = new AsyncLocalStorage<Scope>();
const rootScope = new Scope();
// Tag the root so breadcrumbs added outside of a per-request frame are
// silently dropped — otherwise background timers and top-level captures
// would accumulate breadcrumbs that bleed into every later event from
// every later request.
rootScope.rejectsBreadcrumbs = true;

export function getCurrentScope(): Scope {
  return als.getStore() ?? rootScope;
}

/**
 * Fork the current scope, bind it to a new ALS frame, and run the callback
 * inside it. Mutations to the forked scope only live for the callback.
 */
export function withScope<T>(cb: (scope: Scope) => T): T {
  const next = getCurrentScope().clone();
  return als.run(next, () => cb(next));
}

/**
 * Bind an existing scope (already prepared) to a new ALS frame. Used by
 * request wrappers that want the freshly-forked scope to span the entire
 * inflight request, including downstream `await`s.
 */
export function runWithScope<T>(scope: Scope, cb: () => T): T {
  return als.run(scope, cb);
}

/** Test-only — clear the root scope and exit any active ALS frame. */
export function __resetHubForTests(): void {
  rootScope.clear();
}
