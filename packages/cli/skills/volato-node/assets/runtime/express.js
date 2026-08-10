import { captureNodeException } from "./node.js";

function safeString(value, max) {
  return typeof value === "string" && value.length > 0 ? value.slice(0, max) : undefined;
}

function normalizedRoute(req) {
  const base = safeString(req.baseUrl, 2_048) ?? "";
  const path = safeString(req.route?.path, 2_048);
  if (!path) return base || undefined;
  return `${base}${path}`.replace(/\/+/g, "/").slice(0, 4_096);
}

export function volatoExpressErrorHandler() {
  return async function volatoExpressErrorMiddleware(error, req, res, next) {
    try {
      await captureNodeException(error, {
        capturedVia: "express",
        method: safeString(req.method, 32),
        route: normalizedRoute(req),
        status: typeof res.statusCode === "number" && res.statusCode >= 400 ? res.statusCode : undefined,
        requestId: safeString(req.id ?? req.get?.("x-request-id"), 256),
      });
    } finally {
      next(error);
    }
  };
}
