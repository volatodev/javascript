/**
 * Server-runtime capture (RSC — React Server Components, Node runtime only).
 * Edge-runtime (middleware) capture lives in `./middleware`.
 *
 * Hard constraint: never import `node:crypto` or any Node-only module that
 * would break runtime uniformity. Generated capture is transport-only —
 * fingerprinting happens at `/api/ingest`.
 */

import {
  dsnToIngestUrl,
  VOLATO_DSN_HEADER,
  type Breadcrumb,
  type Level,
  type User,
} from "./protocol";
import {
  __resetHubForTests as __resetHub,
  getCurrentScope,
  runWithScope,
  withScope,
} from "./internal/hub-node";
import { unwrapCauseChain } from "./internal/linked-errors";
import { applyBuildIdentityTo } from "./internal/release";
import { runBeforeSend } from "./internal/before-send";
import { shouldSend } from "./internal/dedupe";
import { shouldKeep } from "./internal/filters";
import {
  scrubPath,
  scrubSearchParams,
  scrubUrl,
} from "./internal/scrub-url";
import { serializeEnvelope } from "./internal/serialize";
import { sendEnvelope } from "./internal/transport";
export { createTunnelHandler, type TunnelOptions } from "./tunnel";
import type { LinkedError } from "./protocol";
import type { VolatoConfig } from "./index";

type ServerExtras = Pick<
  VolatoConfig,
  | "beforeSend"
  | "release"
  | "commitSha"
  | "environment"
  | "dist"
  | "ignoreErrors"
  | "captureIp"
>;
let serverExtras: ServerExtras = {};

/**
 * Configure server-side capture extras: `beforeSend` hook, explicit
 * `release` / `environment` / `dist` overrides. Idempotent — call from
 * the `register()` hook in `instrumentation.ts`. The DSN itself still
 * comes from `process.env.NEXT_PUBLIC_VOLATO_DSN`.
 */
export function initServer(config: ServerExtras): void {
  serverExtras = { ...serverExtras, ...config };
}

function captureEnvironment(): string {
  return (
    serverExtras.environment?.trim() ||
    process.env.VOLATO_ENVIRONMENT?.trim() ||
    process.env.NEXT_PUBLIC_VOLATO_ENVIRONMENT?.trim() ||
    process.env.NODE_ENV?.trim() ||
    "production"
  );
}

const WHITELISTED_HEADERS = [
  "user-agent",
  "referer",
] as const;

export type ServerRuntime =
  | "rsc"
  | "server_action"
  | "route_handler"
  | "middleware";

export type CapturedVia =
  | "wrap_action"
  | "wrap_route"
  | "wrap_middleware"
  | "on_request_error"
  | "error_boundary"
  | "manual";

export type RequestSummary = {
  method: string;
  url: string;
  pathname?: string;
  searchParams?: Record<string, string | string[]>;
};

export type ServerCaptureContext = {
  route?: string;
  headers?: Headers;
  runtime?: ServerRuntime;
  capturedVia?: CapturedVia;
  request?: Request | RequestSummary;
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
  commitSha?: string;
  environment?: string;
  dist?: string;
  capturedVia?: CapturedVia;
  request?: RequestSummary;
};

function summarizeRequest(input: Request | RequestSummary): RequestSummary {
  if ("method" in input && typeof (input as Request).headers === "undefined") {
    const summary = input as RequestSummary;
    return {
      method: summary.method,
      url: scrubUrl(summary.url),
      ...(summary.pathname ? { pathname: scrubPath(summary.pathname) } : {}),
      ...(summary.searchParams
        ? { searchParams: scrubSearchParams(summary.searchParams) }
        : {}),
    };
  }
  const req = input as Request;
  let pathname: string | undefined;
  let searchParams: Record<string, string | string[]> | undefined;
  try {
    const url = new URL(req.url);
    pathname = scrubPath(url.pathname);
    const sp: Record<string, string | string[]> = {};
    for (const key of new Set(url.searchParams.keys())) {
      const all = url.searchParams.getAll(key);
      sp[key] = all.length > 1 ? all : all[0]!;
    }
    if (Object.keys(sp).length > 0) searchParams = scrubSearchParams(sp);
  } catch {
    // Malformed URL — keep scrubbed `req.url`, no path/searchParams.
  }
  return {
    method: req.method,
    url: scrubUrl(req.url),
    pathname,
    searchParams,
  };
}

function whitelist(headers: Headers | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!headers) return out;
  for (const name of WHITELISTED_HEADERS) {
    const value = headers.get(name);
    if (value !== null) out[name] = name === "referer" ? scrubUrl(value) : value;
  }
  if (serverExtras.captureIp) {
    const forwardedFor = headers.get("x-forwarded-for");
    if (forwardedFor !== null) out["x-forwarded-for"] = forwardedFor;
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
    route: ctx?.route ? scrubPath(ctx.route) : null,
    headers: whitelist(ctx?.headers),
    runtime: ctx?.runtime ?? "rsc",
    timestamp: Date.now(),
  };
  if (ctx?.capturedVia) payload.capturedVia = ctx.capturedVia;
  if (ctx?.request) payload.request = summarizeRequest(ctx.request);

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
  if (serverExtras.commitSha && !target.commitSha)
    target.commitSha = serverExtras.commitSha;
  if (serverExtras.environment && !target.environment)
    target.environment = serverExtras.environment;
  if (serverExtras.dist && !target.dist) target.dist = serverExtras.dist;
  applyBuildIdentityTo(target);
  getCurrentScope().applyTo(target);
  return payload;
}

/**
 * Send a server-side (RSC) error to Volato. Reads DSN from
 * `process.env.NEXT_PUBLIC_VOLATO_DSN` (the `NEXT_PUBLIC_*` prefix is
 * read on the server too — same single source of truth as the browser).
 * No-ops with a `console.warn` when the env var is unset — by design,
 * a missing DSN must never crash the host app.
 *
 * The returned promise covers the bounded transport attempt. Next.js request
 * lifecycle hooks can therefore await capture without risking an unbounded
 * hang, while callers that cannot wait may still explicitly discard it.
 */
async function captureExceptionWithDelivery(
  err: unknown,
  ctx?: ServerCaptureContext,
): Promise<boolean> {
  const dsn = process.env.NEXT_PUBLIC_VOLATO_DSN;
  if (!dsn) {
    if (typeof console !== "undefined" && console.warn) {
      console.warn(
        "[Volato] captureException skipped: NEXT_PUBLIC_VOLATO_DSN env var is not set",
      );
    }
    return false;
  }
  if (captureEnvironment() === "development") return false;

  const payload = serialize(err, ctx);
  const asEvent = payload as unknown as Record<string, unknown>;
  if (!shouldKeep(asEvent, serverExtras)) return false;
  if (!shouldSend(asEvent)) return false;
  const filtered = runBeforeSend(serverExtras.beforeSend, asEvent);
  if (filtered === null) return false;

  const serialized = serializeEnvelope(filtered);
  return sendEnvelope(
    dsnToIngestUrl(dsn),
    { [VOLATO_DSN_HEADER]: dsn },
    serialized.body,
  );
}

export async function captureException(
  err: unknown,
  ctx?: ServerCaptureContext,
): Promise<void> {
  await captureExceptionWithDelivery(err, ctx);
}

/**
 * Internal hook used only by the CLI's temporary local verification route.
 * Application capture keeps the stable Promise<void> contract above.
 */
export const __captureExceptionWithDelivery = captureExceptionWithDelivery;

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
        await captureException(err, {
          runtime: "server_action",
          route,
          capturedVia: "wrap_action",
        });
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
    capturedVia: "wrap_action",
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
      capturedVia: "wrap_route",
      request: req,
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
          capturedVia: "wrap_route",
          request: req,
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
