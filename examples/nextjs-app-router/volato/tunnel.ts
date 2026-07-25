/**
 * Optional same-origin tunnel route handler.
 *
 * Direct browser-to-ingest delivery is the safe default. Applications that
 * explicitly opt into a tunnel must also create a route that calls this
 * handler and set the matching `tunnel` path in `VolatoBootstrap`.
 */

import {
  VOLATO_DSN_HEADER,
  VOLATO_REASON_HEADER,
  VOLATO_USAGE_WARN_HEADER,
  dsnToIngestUrl,
  parseDSN,
} from "./protocol";

const DEFAULT_MAX_BODY_BYTES = 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 5_000;

export type TunnelOptions = {
  /**
   * Override the ingest DSN. Defaults to `process.env.NEXT_PUBLIC_VOLATO_DSN`.
   * Must be a complete `https://<publicKey>@<host>/<projectId>` string.
   */
  dsn?: string;
  /** Maximum request body accepted before returning 413. */
  maxBodyBytes?: number;
  /** Upstream request deadline before returning 504. */
  timeoutMs?: number;
};

type TunnelHandler = (req: Request) => Promise<Response>;

class BodyTooLargeError extends Error {}

async function readLimitedBody(
  req: Request,
  maxBytes: number,
): Promise<string> {
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new BodyTooLargeError();
  }
  if (!req.body) return "";

  const reader = req.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let body = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new BodyTooLargeError();
    }
    body += decoder.decode(value, { stream: true });
  }
  body += decoder.decode();
  return body;
}

export function createTunnelHandler(options: TunnelOptions = {}): TunnelHandler {
  return async function tunnel(req: Request): Promise<Response> {
    if (req.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405 });
    }
    const dsn = options.dsn ?? process.env.NEXT_PUBLIC_VOLATO_DSN;
    if (!dsn) {
      return new Response("NEXT_PUBLIC_VOLATO_DSN not configured", {
        status: 500,
      });
    }
    try {
      parseDSN(dsn);
    } catch {
      return new Response("NEXT_PUBLIC_VOLATO_DSN is malformed", {
        status: 500,
      });
    }

    const contentType = req.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().startsWith("application/json")) {
      return new Response("Unsupported Media Type", { status: 415 });
    }
    const headerDsn = req.headers.get(VOLATO_DSN_HEADER);
    if (!headerDsn) {
      return new Response("Missing X-Volato-DSN", { status: 400 });
    }
    if (headerDsn !== dsn) {
      return new Response("DSN does not match this tunnel", { status: 403 });
    }

    const maxBodyBytes = Math.max(
      1,
      options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES,
    );
    let body: string;
    try {
      body = await readLimitedBody(req, maxBodyBytes);
    } catch (error) {
      if (error instanceof BodyTooLargeError) {
        return new Response("Payload Too Large", { status: 413 });
      }
      return new Response("Invalid request body", { status: 400 });
    }

    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, Math.max(1, options.timeoutMs ?? DEFAULT_TIMEOUT_MS));
    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        [VOLATO_DSN_HEADER]: dsn,
      };
      for (const name of ["origin", "referer"] as const) {
        const value = req.headers.get(name);
        if (value) headers[name] = value;
      }
      const upstream = await fetch(dsnToIngestUrl(dsn), {
        method: "POST",
        headers,
        body,
        signal: controller.signal,
      });

      const responseHeaders = new Headers();
      for (const name of [
        "retry-after",
        VOLATO_REASON_HEADER,
        VOLATO_USAGE_WARN_HEADER,
      ]) {
        const value = upstream.headers.get(name);
        if (value) responseHeaders.set(name, value);
      }
      return new Response(null, {
        status: upstream.status,
        headers: responseHeaders,
      });
    } catch {
      return new Response(null, { status: timedOut ? 504 : 502 });
    } finally {
      clearTimeout(timer);
    }
  };
}
