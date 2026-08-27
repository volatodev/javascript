import { captureNodeException } from "./node.js";

type FastifyRequest = {
  method?: unknown;
  id?: unknown;
  routeOptions?: { url?: unknown };
};

type FastifyReply = {
  statusCode?: unknown;
};

type FastifyError = {
  statusCode?: unknown;
};

function safeString(value: unknown, max: number): string | undefined {
  return typeof value === "string" && value.length > 0
    ? value.slice(0, max)
    : undefined;
}

function normalizedRoute(request: FastifyRequest): string | undefined {
  return safeString(request.routeOptions?.url, 4_096)
    ?.split(/[?#]/, 1)[0]
    ?.replace(/\/{2,}/g, "/");
}

function errorStatus(reply: FastifyReply, error: FastifyError): number | undefined {
  for (const candidate of [reply.statusCode, error.statusCode]) {
    if (
      typeof candidate === "number" &&
      Number.isInteger(candidate) &&
      candidate >= 400 &&
      candidate <= 599
    ) {
      return candidate;
    }
  }
  return undefined;
}

export function volatoFastifyErrorHook() {
  return async function volatoFastifyOnError(
    request: FastifyRequest,
    reply: FastifyReply,
    error: unknown,
  ): Promise<void> {
    await captureNodeException(error, {
      capturedVia: "fastify",
      method: safeString(request.method, 32),
      route: normalizedRoute(request),
      status: errorStatus(reply, error as FastifyError),
      requestId: safeString(request.id, 256),
    });
  };
}
