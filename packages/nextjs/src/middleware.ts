/**
 * Edge-runtime (Next.js middleware) capture.
 *
 * @edge-safe — this module must stay importable in the Next.js Edge
 * runtime. Only Web standard APIs and the Vercel-supported Node subset
 * (`node:async_hooks` for AsyncLocalStorage, since Next 13.4) are
 * allowed. No `Buffer`, no `process.env`, no `require(`, no other
 * `node:*` imports.
 */

import {
  dsnToIngestUrl,
  VOLATO_DSN_HEADER,
  type Breadcrumb,
  type Level,
  type User,
} from "@volatodev/core";
import {
  __resetHubForTests as __resetHub,
  getCurrentScope,
  runWithScope,
  withScope,
} from "./internal/hub-node";
import { unwrapCauseChain } from "./internal/linked-errors";
import { runBeforeSend } from "./internal/before-send";
import { shouldKeep } from "./internal/filters";
import type { VolatoConfig } from "./index";
import type { LinkedError } from "@volatodev/core";

export type EdgeErrorPayload = {
  type: string;
  message: string;
  stack: string | null;
  url: string;
  method: string;
  runtime: "middleware";
  timestamp: number;
  linkedErrors?: LinkedError[];
  release?: string;
  environment?: string;
  dist?: string;
};

/**
 * Send an Edge-runtime error to Volato. Uses `fetch` with `keepalive: true`
 * so the request survives the middleware's short Edge lifecycle.
 */
export async function captureException(
  err: unknown,
  req: Request,
  config: VolatoConfig,
): Promise<void> {
  try {
    const e = err instanceof Error ? err : new Error(String(err));
    const payload: EdgeErrorPayload = {
      type: e.name ?? "Error",
      message: e.message ?? "",
      stack: e.stack ?? null,
      url: req.url,
      method: req.method,
      runtime: "middleware",
      timestamp: Date.now(),
    };
    const chain = unwrapCauseChain(err);
    if (chain.length > 0) payload.linkedErrors = chain;
    if (config.release) payload.release = config.release;
    if (config.environment) payload.environment = config.environment;
    if (config.dist) payload.dist = config.dist;
    const asEvent = payload as unknown as Record<string, unknown>;
    getCurrentScope().applyTo(asEvent);
    if (!shouldKeep(asEvent, config)) return;
    const filtered = runBeforeSend(config.beforeSend, asEvent);
    if (filtered === null) return;
    await fetch(dsnToIngestUrl(config.dsn), {
      method: "POST",
      keepalive: true,
      headers: {
        "Content-Type": "application/json",
        [VOLATO_DSN_HEADER]: config.dsn,
      },
      body: JSON.stringify(filtered),
    });
  } catch {
    // swallow: never break the user request via our instrumentation
  }
}

/**
 * Wrap a Next.js middleware so any thrown error is reported to Volato before
 * being re-thrown. Re-throwing preserves Next.js's native 500 behaviour.
 *
 * Each invocation runs inside its own AsyncLocalStorage scope so concurrent
 * requests cannot see each other's `setUser` / `setTag` calls.
 */
export function wrapMiddleware<
  T extends (req: Request, ev?: any) => Promise<Response> | Response,
>(mw: T, config: VolatoConfig): T {
  return (async (req: Request, ev?: unknown) => {
    return runWithScope(getCurrentScope().clone(), async () => {
      try {
        return await mw(req, ev);
      } catch (err) {
        await captureException(err, req, config);
        throw err;
      }
    });
  }) as T;
}

/* ───────────────────────── Scope public API ───────────────────────── */

export { withScope, getCurrentScope };

export function setUser(user: User | null): void {
  getCurrentScope().setUser(user);
}

export function setTag(key: string, value: string): void {
  getCurrentScope().setTag(key, value);
}

export function setTags(tags: Record<string, string>): void {
  getCurrentScope().setTags(tags);
}

export function setContext(
  key: string,
  ctx: Record<string, unknown> | null,
): void {
  getCurrentScope().setContext(key, ctx);
}

export function setExtra(key: string, value: unknown): void {
  getCurrentScope().setExtra(key, value);
}

export function setLevel(level: Level): void {
  getCurrentScope().setLevel(level);
}

export function setFingerprint(fingerprint: string[]): void {
  getCurrentScope().setFingerprint(fingerprint);
}

export function addBreadcrumb(crumb: Partial<Breadcrumb>): void {
  getCurrentScope().addBreadcrumb(crumb);
}

/** Test-only — reset hub root scope. */
export function __resetHubForTests(): void {
  __resetHub();
}
