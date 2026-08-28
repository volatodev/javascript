import { defineMiddleware } from "astro:middleware";
import { captureNodeException, initVolatoNode } from "./node.mjs";

const release =
  typeof __VOLATO_SERVER_RELEASE__ === "undefined"
    ? undefined
    : __VOLATO_SERVER_RELEASE__;

initVolatoNode({ installFatalHandlers: false, release });

function safeString(value, max) {
  return typeof value === "string" && value.length > 0
    ? value.slice(0, max)
    : undefined;
}

function normalizedRoute(context) {
  return safeString(context?.routePattern, 4_096)
    ?.split(/[?#]/, 1)[0]
    ?.replace(/\/{2,}/g, "/");
}

export const onRequest = defineMiddleware(async (context, next) => {
  try {
    return await next();
  } catch (error) {
    try {
      await captureNodeException(error, {
        capturedVia: "astro_middleware",
        method: safeString(context?.request?.method, 32)?.toUpperCase(),
        route: normalizedRoute(context),
        status: 500,
        requestId: safeString(
          context?.request?.headers?.get?.("x-request-id"),
          256,
        ),
      });
    } catch (captureError) {
      console.warn("[Volato] Astro middleware capture failed.", captureError);
    }
    throw error;
  }
});
