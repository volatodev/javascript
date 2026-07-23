/**
 * Browser hub — single-threaded, stack-based scope manager.
 *
 * `withScope` pushes a forked scope, runs the callback, then pops. No
 * AsyncLocalStorage needed: the browser has one event loop and we can't
 * have concurrent requests interleaving on the same hub.
 */
import { Scope } from "./scope";

let stack: Scope[] = [new Scope()];

export function getCurrentScope(): Scope {
  return stack[stack.length - 1] ?? stack[0]!;
}

export function withScope<T>(cb: (scope: Scope) => T): T {
  const next = getCurrentScope().clone();
  stack.push(next);
  try {
    return cb(next);
  } finally {
    stack.pop();
  }
}

/** Test-only — wipe the stack back to a single empty scope. */
export function __resetHubForTests(): void {
  stack = [new Scope()];
}
