/**
 * Edge-runtime (Next.js middleware) capture.
 *
 * @edge-safe — this module must stay importable in the Next.js Edge runtime.
 * No `node:*` imports, no `Buffer`, no `process.env`, no `require(`. Only
 * standard Web APIs (`fetch`, `Request`, `URL`) are allowed.
 */

import { dsnToIngestUrl, VOLATO_DSN_HEADER } from "@volatodev/core";
import type { VolatoConfig } from "./index";

export type EdgeErrorPayload = {
  type: string;
  message: string;
  stack: string | null;
  url: string;
  method: string;
  runtime: "middleware";
  timestamp: number;
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
    await fetch(dsnToIngestUrl(config.dsn), {
      method: "POST",
      keepalive: true,
      headers: {
        "Content-Type": "application/json",
        [VOLATO_DSN_HEADER]: config.dsn,
      },
      body: JSON.stringify(payload),
    });
  } catch {
    // swallow: never break the user request via our instrumentation
  }
}

/**
 * Wrap a Next.js middleware so any thrown error is reported to Volato before
 * being re-thrown. Re-throwing preserves Next.js's native 500 behaviour.
 */
export function wrapMiddleware<
  T extends (req: Request, ev?: any) => Promise<Response> | Response,
>(mw: T, config: VolatoConfig): T {
  return (async (req: Request, ev?: unknown) => {
    try {
      return await mw(req, ev);
    } catch (err) {
      await captureException(err, req, config);
      throw err;
    }
  }) as T;
}
