import { captureNodeException, initVolatoNode } from "./node";

declare const __VOLATO_SERVER_RELEASE__: string | undefined;

type NitroError = Error & {
  cause?: unknown;
  statusCode?: unknown;
  unhandled?: unknown;
};

type NitroEvent = {
  method?: unknown;
  headers?: { get?: (name: string) => unknown };
  context?: {
    matchedRoute?: { path?: unknown };
    requestId?: unknown;
  };
};

type NitroApp = {
  hooks: {
    hook: (
      name: "error",
      callback: (error: NitroError, context: { event?: NitroEvent }) => Promise<void>,
    ) => void;
  };
};

function safeString(value: unknown, max: number): string | undefined {
  return typeof value === "string" && value.length > 0
    ? value.slice(0, max)
    : undefined;
}

function causalError(error: NitroError, event?: NitroEvent): unknown | null {
  if (error.cause instanceof Error) return error.cause;
  if (error.unhandled === true) return error;
  return event === undefined && error instanceof Error ? error : null;
}

function normalizedRoute(event?: NitroEvent): string | undefined {
  return safeString(event?.context?.matchedRoute?.path, 4_096)
    ?.split(/[?#]/, 1)[0]
    ?.replace(/\/{2,}/g, "/");
}

function errorStatus(error: NitroError): number | undefined {
  return typeof error.statusCode === "number" &&
    Number.isInteger(error.statusCode) &&
    error.statusCode >= 400 &&
    error.statusCode <= 599
    ? error.statusCode
    : undefined;
}

export function installVolatoNitro(nitroApp: NitroApp): void {
  const release =
    typeof __VOLATO_SERVER_RELEASE__ === "undefined"
      ? undefined
      : __VOLATO_SERVER_RELEASE__;
  initVolatoNode({ installFatalHandlers: false, release });
  nitroApp.hooks.hook("error", async (error, { event }) => {
    const cause = causalError(error, event);
    if (cause === null) return;
    const requestId =
      event?.context?.requestId ?? event?.headers?.get?.("x-request-id");
    await captureNodeException(cause, {
      capturedVia: "nitro_error",
      method: safeString(event?.method, 32)?.toUpperCase(),
      route: normalizedRoute(event),
      status: errorStatus(error),
      requestId: safeString(requestId, 256),
    });
  });
}
