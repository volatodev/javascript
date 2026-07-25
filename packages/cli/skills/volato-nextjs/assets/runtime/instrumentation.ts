/**
 * Next.js 15 `instrumentation.ts` integration.
 *
 * Re-export `onRequestError` from your app's `instrumentation.ts` to capture
 * every server-side error Next.js sees natively — including the cases that
 * `wrapAction` / `wrapRoute` / `wrapMiddleware` cannot reach by themselves.
 *
 *   // instrumentation.ts (project root, sibling of next.config.ts)
 *   export { onRequestError } from "./volato/instrumentation";
 *
 * Generated capture reads `NEXT_PUBLIC_VOLATO_DSN` from `process.env`.
 */

import { scrubPath, scrubUrl } from "./internal/scrub-url";
import { captureException, type ServerRuntime } from "./server";

type NextRouteType = "render" | "route" | "action" | "middleware";

type NextRequestInfo = {
  path: string;
  method: string;
  headers: Record<string, string>;
};

type NextErrorContext = {
  routerKind?: "Pages Router" | "App Router";
  routePath?: string;
  routeType: NextRouteType;
  renderSource?: string;
  revalidateReason?: string;
  renderType?: string;
};

function mapRuntime(routeType: NextRouteType): ServerRuntime {
  switch (routeType) {
    case "route":
      return "route_handler";
    case "action":
      return "server_action";
    case "middleware":
      return "middleware";
    case "render":
    default:
      return "rsc";
  }
}

function buildHeaders(
  raw: Record<string, string> | undefined,
): Headers | undefined {
  if (!raw) return undefined;
  const h = new Headers();
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === "string") h.set(key, value);
  }
  return h;
}

function buildRequestSummary(
  request: NextRequestInfo | undefined,
): { method: string; url: string; pathname?: string } | undefined {
  if (!request) return undefined;
  // `request.path` from Next.js is `pathname + search` in App Router, so
  // it can carry sensitive query params and token-bearing path segments.
  const queryIdx = request.path.indexOf("?");
  const pathname =
    queryIdx === -1 ? request.path : request.path.slice(0, queryIdx);
  return {
    method: request.method,
    url: scrubUrl(request.path),
    pathname: scrubPath(pathname),
  };
}

/**
 * Next.js 15 `onRequestError` handler. Forwards every server-side error
 * Next.js intercepts to Volato. Re-export verbatim from `instrumentation.ts`.
 */
export async function onRequestError(
  error: unknown,
  request: NextRequestInfo,
  context: NextErrorContext,
): Promise<void> {
  const route = context.routePath ?? request?.path;
  await captureException(error, {
    runtime: mapRuntime(context.routeType),
    route: route ? scrubPath(route) : undefined,
    headers: buildHeaders(request?.headers),
    capturedVia: "on_request_error",
    request: buildRequestSummary(request),
  });
}

/**
 * Optional Next.js `register()` hook. V1 has nothing to bootstrap — exported
 * so users can wire the full instrumentation contract in one import:
 *
 *   export { register, onRequestError } from "./volato/instrumentation";
 */
export function register(): void {
  // intentionally empty — reserved for future bootstrap (OTel, etc.)
}
