import { captureNodeException } from "./node.js";

type ExpressRequest = {
  method?: unknown;
  route?: { path?: unknown };
  id?: unknown;
  get?: (name: string) => unknown;
};

type ExpressResponse = { statusCode?: unknown };
type ExpressNext = (error: unknown) => void;

function safeString(value: unknown, max: number): string | undefined {
  return typeof value === "string" && value.length > 0
    ? value.slice(0, max)
    : undefined;
}

function normalizedRoute(req: ExpressRequest): string | undefined {
  return safeString(req.route?.path, 4_096)?.replace(/\/+/g, "/");
}

export function volatoExpressErrorHandler() {
  return async function volatoExpressErrorMiddleware(
    error: unknown,
    req: ExpressRequest,
    res: ExpressResponse,
    next: ExpressNext,
  ): Promise<void> {
    try {
      const candidateId = req.id ?? req.get?.("x-request-id");
      await captureNodeException(error, {
        capturedVia: "express",
        method: safeString(req.method, 32),
        route: normalizedRoute(req),
        status:
          typeof res.statusCode === "number" && res.statusCode >= 400
            ? res.statusCode
            : undefined,
        requestId: safeString(candidateId, 256),
      });
    } finally {
      next(error);
    }
  };
}
