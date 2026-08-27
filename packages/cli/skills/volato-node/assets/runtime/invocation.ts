import { captureNodeException, initVolatoNode } from "./node.js";

type InvocationRequest = {
  method?: unknown;
  url?: unknown;
  id?: unknown;
  headers?: { "x-request-id"?: unknown };
};

type InvocationResponse = { statusCode?: unknown };

export type VolatoInvocationOptions = {
  functionName: string;
  http?: boolean;
  flushTimeoutMs?: number;
};

function safeString(value: unknown, max: number): string | undefined {
  return typeof value === "string" && value.length > 0
    ? value.slice(0, max)
    : undefined;
}

function boundedTimeout(value: number | undefined): number {
  if (!Number.isFinite(value)) return 2_000;
  return Math.max(1, Math.min(2_000, Math.floor(value!)));
}

function normalizedRoute(request: InvocationRequest): string | undefined {
  const raw = safeString(request.url, 16_384);
  if (!raw) return undefined;
  try {
    const pathname = new URL(raw, "http://volato.invalid").pathname;
    const depth = pathname.split("/").filter(Boolean).length;
    return depth === 0
      ? "/"
      : `/${Array.from({ length: depth }, () => ":segment").join("/")}`;
  } catch {
    return undefined;
  }
}

function httpContext(args: unknown[]): {
  method?: string;
  route?: string;
  status?: number;
  requestId?: string;
} {
  const request =
    args[0] && typeof args[0] === "object"
      ? (args[0] as InvocationRequest)
      : {};
  const response =
    args[1] && typeof args[1] === "object"
      ? (args[1] as InvocationResponse)
      : {};
  const requestId = request.id ?? request.headers?.["x-request-id"];
  return {
    method: safeString(request.method, 32),
    route: normalizedRoute(request),
    status:
      typeof response.statusCode === "number" && response.statusCode >= 400
        ? response.statusCode
        : undefined,
    requestId: safeString(requestId, 256),
  };
}

export function withVolatoInvocation<
  This,
  Args extends unknown[],
  Result,
>(
  handler: (this: This, ...args: Args) => Promise<Result>,
  options: VolatoInvocationOptions,
): (this: This, ...args: Args) => Promise<Result> {
  const timeoutMs = boundedTimeout(options.flushTimeoutMs);
  initVolatoNode({ installFatalHandlers: false, timeoutMs });

  return async function volatoInvocation(
    this: This,
    ...args: Args
  ): Promise<Result> {
    try {
      return await handler.apply(this, args);
    } catch (failure) {
      try {
        await captureNodeException(failure, {
          capturedVia: "invocation",
          functionName: options.functionName,
          ...(options.http ? httpContext(args) : {}),
        });
      } finally {
        throw failure;
      }
    }
  };
}
