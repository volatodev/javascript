/**
 * Server-runtime capture (RSC — React Server Components, Node runtime only).
 * Edge-runtime (middleware) capture lives in `./middleware`.
 *
 * Hard constraint: never import `node:crypto` or any Node-only module that
 * would break SDK uniformity across runtimes. The SDK is transport-only —
 * fingerprinting happens on the server at `/api/ingest`.
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
import { applyReleaseTo } from "./internal/release";
import { runBeforeSend } from "./internal/before-send";
import type { LinkedError } from "@volatodev/core";
import type { VolatoConfig } from "./index";

type ServerExtras = Pick<
  VolatoConfig,
  "beforeSend" | "release" | "environment" | "dist"
>;
let serverExtras: ServerExtras = {};

/**
 * Configure server-side capture extras: `beforeSend` hook, explicit
 * `release` / `environment` / `dist` overrides. Idempotent — call from
 * the `register()` hook in `instrumentation.ts`. The DSN itself still
 * comes from `process.env.VOLATO_DSN`.
 */
export function initServer(config: ServerExtras): void {
  serverExtras = { ...serverExtras, ...config };
}

const WHITELISTED_HEADERS = [
  "user-agent",
  "referer",
  "x-forwarded-for",
] as const;

export type ServerRuntime =
  | "rsc"
  | "server_action"
  | "route_handler"
  | "middleware";

export type ServerCaptureContext = {
  route?: string;
  headers?: Headers;
  runtime?: ServerRuntime;
};

export type ServerErrorPayload = {
  type: string;
  message: string;
  stack: string | null;
  route: string | null;
  headers: Record<string, string>;
  runtime: ServerRuntime;
  timestamp: number;
  linkedErrors?: LinkedError[];
  release?: string;
  environment?: string;
  dist?: string;
};

function whitelist(headers: Headers | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!headers) return out;
  for (const name of WHITELISTED_HEADERS) {
    const value = headers.get(name);
    if (value !== null) out[name] = value;
  }
  return out;
}

function serialize(
  err: unknown,
  ctx?: ServerCaptureContext,
): ServerErrorPayload {
  const payload: ServerErrorPayload = {
    type: "Error",
    message: "Unknown error",
    stack: null,
    route: ctx?.route ?? null,
    headers: whitelist(ctx?.headers),
    runtime: ctx?.runtime ?? "rsc",
    timestamp: Date.now(),
  };

  if (err instanceof Error) {
    payload.type = err.constructor.name || "Error";
    payload.message = err.message;
    payload.stack = err.stack ?? null;
  } else if (typeof err === "string") {
    payload.message = err;
  } else if (err !== null && err !== undefined) {
    try {
      payload.message = JSON.stringify(err);
    } catch {
      payload.message = String(err);
    }
  }

  const chain = unwrapCauseChain(err);
  if (chain.length > 0) payload.linkedErrors = chain;
  const target = payload as unknown as Record<string, unknown>;
  if (serverExtras.release && !target.release) target.release = serverExtras.release;
  if (serverExtras.environment && !target.environment)
    target.environment = serverExtras.environment;
  if (serverExtras.dist && !target.dist) target.dist = serverExtras.dist;
  applyReleaseTo(target);
  getCurrentScope().applyTo(target);
  return payload;
}

/**
 * Send a server-side (RSC) error to Volato. Reads DSN from
 * `process.env.VOLATO_DSN`. No-ops with a `console.warn` when the env var
 * is unset — by design, a missing DSN must never crash the host app.
 */
export async function captureException(
  err: unknown,
  ctx?: ServerCaptureContext,
): Promise<void> {
  const dsn = process.env.VOLATO_DSN;
  if (!dsn) {
    if (typeof console !== "undefined" && console.warn) {
      console.warn(
        "[Volato] captureException skipped: VOLATO_DSN env var is not set",
      );
    }
    return;
  }

  const payload = serialize(err, ctx);
  const filtered = runBeforeSend(
    serverExtras.beforeSend,
    payload as unknown as Record<string, unknown>,
  );
  if (filtered === null) return;

  try {
    await fetch(dsnToIngestUrl(dsn), {
      method: "POST",
      body: JSON.stringify(filtered),
      headers: {
        "Content-Type": "application/json",
        [VOLATO_DSN_HEADER]: dsn,
      },
    });
  } catch {
    // Transport errors must never crash the host app.
  }
}

/** Alias matching the user-facing convention from the package spec. */
export const captureServerError = captureException;

/**
 * Wrap a Next.js Server Action so any thrown error is reported to Volato
 * before being re-thrown. Preserves the original error reference.
 *
 * NOTE: this wrapper only sees thrown errors. Server Actions that surface
 * failure via the **return shape** never throw — call `reportActionError`
 * from inside the action's catch branch to capture those.
 */
export function wrapAction<T extends (...args: any[]) => any>(
  action: T,
  opts?: { name?: string },
): T {
  const wrapped = async function (
    this: unknown,
    ...args: Parameters<T>
  ): Promise<Awaited<ReturnType<T>>> {
    return runWithScope(getCurrentScope().clone(), async () => {
      try {
        return await action.apply(this, args);
      } catch (err) {
        const inferred = (action as { name?: string }).name;
        const route = opts?.name ?? (inferred ? inferred : undefined);
        await captureException(err, { runtime: "server_action", route });
        throw err;
      }
    });
  };
  return wrapped as unknown as T;
}

/**
 * Report a Server Action failure that does NOT throw — for the Next 15 idiom
 * `useActionState` where the action RETURNS a failure shape (e.g.
 * `{ error: "..." }`) instead of throwing.
 */
export async function reportActionError(
  err: unknown,
  opts?: { name?: string },
): Promise<void> {
  await captureException(err, {
    runtime: "server_action",
    route: opts?.name,
  });
}

function pathnameOf(req: Request): string | undefined {
  try {
    return new URL(req.url).pathname;
  } catch {
    return undefined;
  }
}

/**
 * Wrap a streamed Response so any error raised by the underlying body
 * AFTER the handler has returned is forwarded to Volato.
 */
function wrapResponseStream(res: Response, req: Request): Response {
  if (!res.body) return res;
  const passthrough = new TransformStream<Uint8Array, Uint8Array>();
  const route = pathnameOf(req);

  void res.body.pipeTo(passthrough.writable).catch((err: unknown) => {
    void captureException(err, {
      runtime: "route_handler",
      route,
      headers: req.headers,
    });
  });

  return new Response(passthrough.readable, {
    status: res.status,
    statusText: res.statusText,
    headers: res.headers,
  });
}

/**
 * Wrap a Next.js Route Handler so any thrown error is reported to Volato
 * before being re-thrown. Also observes the returned Response's body stream.
 *
 * Each wrapped invocation runs inside a forked AsyncLocalStorage scope so
 * that `setUser` / `setTag` / `addBreadcrumb` calls made during the request
 * don't leak into other concurrent requests.
 */
export function wrapRoute<
  T extends (req: Request, ctx?: any) => Promise<Response> | Response,
>(handler: T): T {
  const wrapped = async function (
    this: unknown,
    req: Request,
    ctx?: unknown,
  ): Promise<Response> {
    return runWithScope(getCurrentScope().clone(), async () => {
      try {
        const res = await handler.call(this, req, ctx);
        return wrapResponseStream(res, req);
      } catch (err) {
        await captureException(err, {
          runtime: "route_handler",
          route: pathnameOf(req),
          headers: req.headers,
        });
        throw err;
      }
    });
  };
  return wrapped as unknown as T;
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
