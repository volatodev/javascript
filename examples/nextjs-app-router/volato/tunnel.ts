/**
 * Same-origin tunnel route handler.
 *
 * Adblockers block requests to `*.ingest.*` domains in the browser. Routing
 * browser capture POSTs through a route on the host's own origin (defaulting to
 * `/monitoring`) sidesteps the filter. The handler reads the body verbatim
 * and forwards to the real ingest URL — no transformation.
 *
 *   // app/monitoring/route.ts
 *   import { createTunnelHandler } from "../../../volato/server";
 *   export const POST = createTunnelHandler();
 *
 * Defaults:
 *   - DSN comes from `process.env.NEXT_PUBLIC_VOLATO_DSN` (Next.js exposes
 *     `NEXT_PUBLIC_*` to server-side code too — same single source of
 *     truth as the browser bundle).
 *   - Method must be POST
 *   - The forwarded request keeps the `X-Volato-DSN` header from the
 *     browser; if missing, we synthesise it from the env DSN.
 */

import {
  VOLATO_DSN_HEADER,
  dsnToIngestUrl,
  parseDSN,
} from "./protocol";

export type TunnelOptions = {
  /**
   * Override the ingest DSN. Defaults to `process.env.NEXT_PUBLIC_VOLATO_DSN`.
   * Must be a complete `https://<publicKey>@<host>/<projectId>` string.
   */
  dsn?: string;
};

type TunnelHandler = (req: Request) => Promise<Response>;

export function createTunnelHandler(options: TunnelOptions = {}): TunnelHandler {
  return async function tunnel(req: Request): Promise<Response> {
    if (req.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405 });
    }
    const dsn = options.dsn ?? process.env.NEXT_PUBLIC_VOLATO_DSN;
    if (!dsn) {
      return new Response("NEXT_PUBLIC_VOLATO_DSN not configured", { status: 500 });
    }
    try {
      parseDSN(dsn);
    } catch {
      return new Response("NEXT_PUBLIC_VOLATO_DSN is malformed", { status: 500 });
    }

    const headerDsn = req.headers.get(VOLATO_DSN_HEADER) ?? dsn;
    const body = await req.text();

    try {
      const upstream = await fetch(dsnToIngestUrl(dsn), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          [VOLATO_DSN_HEADER]: headerDsn,
        },
        body,
      });
      // Pass through the upstream status so the generated transport's retry
      // logic still applies end-to-end.
      return new Response(null, {
        status: upstream.status,
        headers: upstream.headers,
      });
    } catch {
      return new Response(null, { status: 502 });
    }
  };
}
