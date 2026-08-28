import { captureNodeException, initVolatoNode } from "./node.js";

function safeString(value, max) {
  return typeof value === "string" && value.length > 0
    ? value.slice(0, max)
    : undefined;
}

function captureContext(input) {
  try {
    const status =
      typeof input.status === "number" &&
      Number.isInteger(input.status) &&
      input.status >= 400 &&
      input.status <= 599
        ? input.status
        : undefined;
    const method = safeString(input.event?.request?.method, 32)?.toUpperCase();
    const route = safeString(input.event?.route?.id, 4_096)
      ?.split(/[?#]/, 1)[0]
      ?.replace(/\/{2,}/g, "/");
    const requestId = safeString(
      input.event?.request?.headers?.get?.("x-request-id"),
      256,
    );
    return {
      capturedVia: "sveltekit_server_handle_error",
      method,
      route,
      status,
      requestId,
    };
  } catch {
    return { capturedVia: "sveltekit_server_handle_error" };
  }
}

const release =
  typeof __VOLATO_SERVER_RELEASE__ === "undefined"
    ? undefined
    : __VOLATO_SERVER_RELEASE__;
initVolatoNode({ installFatalHandlers: false, release });

export function createVolatoSvelteKitServerHandleError(application) {
  return function volatoSvelteKitServerHandleError(input) {
    void captureNodeException(input.error, captureContext(input)).catch(
      () => undefined,
    );
    if (application) return application.call(this, input);
    return { message: input.message };
  };
}
