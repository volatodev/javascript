"use client";

import { useEffect } from "react";
import { dsnToIngestUrl, VOLATO_DSN_HEADER } from "@volatodev/core";
import type { VolatoConfig } from "./index";

export type ClientErrorPayload = {
  type: string;
  message: string;
  stack: string | null;
  url: string;
  userAgent: string;
  timestamp: number;
  runtime: "client";
  componentStack?: string;
  filename?: string;
  lineno?: number;
  colno?: number;
  digest?: string;
  actionName?: string;
};

let activeConfig: VolatoConfig | null = null;

function resolveEnvironment(config: VolatoConfig): string {
  if (config.environment) return config.environment;
  if (typeof process !== "undefined" && process.env && process.env.NODE_ENV) {
    return process.env.NODE_ENV;
  }
  return "production";
}

function isEnabled(config: VolatoConfig | null): config is VolatoConfig {
  if (!config || !config.dsn) return false;
  return resolveEnvironment(config) !== "development";
}

type ClientCaptureExtra = {
  componentStack?: string;
  filename?: string;
  lineno?: number;
  colno?: number;
  digest?: string;
  actionName?: string;
};

type CoercedError = {
  type: string;
  message: string;
  stack: string | null;
  digest?: string;
};

/**
 * Coerce any thrown / rejected value into an Error-shaped payload. Browsers
 * allow `throw "boom"`, `Promise.reject(undefined)`, `reject({ code: 500 })`,
 * etc. — without normalization, the LLM gets `message: "[object Object]"`
 * or `message: ""`, which is useless.
 */
function coerceError(value: unknown): CoercedError {
  if (value instanceof Error) {
    const out: CoercedError = {
      type: value.name || "Error",
      message: value.message,
      stack: value.stack ?? null,
    };
    const digest = (value as { digest?: unknown }).digest;
    if (typeof digest === "string" && digest.length > 0) out.digest = digest;
    return out;
  }
  if (typeof value === "string") {
    return { type: "Error", message: value, stack: null };
  }
  if (value === null) {
    return { type: "Error", message: "Rejected with null", stack: null };
  }
  if (value === undefined) {
    return { type: "Error", message: "Rejected with undefined", stack: null };
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const messageField = typeof obj.message === "string" ? obj.message : "";
    const nameField = typeof obj.name === "string" ? obj.name : "";
    const stackField = typeof obj.stack === "string" ? obj.stack : null;
    if (messageField || nameField || stackField) {
      return {
        type: nameField || "Error",
        message: messageField || "Unknown error",
        stack: stackField,
      };
    }
    let message: string;
    try {
      message = JSON.stringify(obj);
    } catch {
      message = String(obj);
    }
    return { type: "Error", message: message || "Unknown error", stack: null };
  }
  return { type: "Error", message: String(value), stack: null };
}

function serialize(
  error: unknown,
  extra?: ClientCaptureExtra,
): ClientErrorPayload {
  const coerced = coerceError(error);
  const payload: ClientErrorPayload = {
    type: coerced.type,
    message: coerced.message,
    stack: coerced.stack,
    url: typeof location !== "undefined" ? location.href : "",
    userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "",
    timestamp: Date.now(),
    runtime: "client",
  };
  if (coerced.digest) payload.digest = coerced.digest;

  if (extra?.componentStack) payload.componentStack = extra.componentStack;
  if (extra?.filename) payload.filename = extra.filename;
  if (typeof extra?.lineno === "number") payload.lineno = extra.lineno;
  if (typeof extra?.colno === "number") payload.colno = extra.colno;
  if (extra?.digest) payload.digest = extra.digest;
  if (extra?.actionName) payload.actionName = extra.actionName;
  return payload;
}

function post(config: VolatoConfig, payload: ClientErrorPayload): void {
  if (typeof fetch === "undefined") return;
  try {
    void fetch(dsnToIngestUrl(config.dsn), {
      method: "POST",
      body: JSON.stringify(payload),
      keepalive: true,
      headers: {
        "Content-Type": "application/json",
        [VOLATO_DSN_HEADER]: config.dsn,
      },
    });
  } catch {
    // Transport errors must never crash the host app.
  }
}

/**
 * Send a client-side error through the active Volato config. Used by
 * `VolatoErrorBoundary` to forward React render errors that `window.onerror`
 * never sees. No-op when no config has been installed or the SDK is disabled.
 */
export function captureClientError(
  error: unknown,
  extra?: ClientCaptureExtra,
): void {
  if (!isEnabled(activeConfig)) return;
  post(activeConfig, serialize(error, extra));
}

/**
 * Attach `error` + `unhandledrejection` listeners to `window` and forward any
 * captured error to `/api/ingest`. Safe to call from module top-level: no-ops
 * in SSR (`window === undefined`), without a DSN, or when the resolved
 * environment is `"development"`.
 */
export function initClient(config: VolatoConfig): void {
  if (typeof window === "undefined") return;
  if (!config.dsn) return;

  activeConfig = config;

  if (resolveEnvironment(config) === "development") {
    if (typeof console !== "undefined" && console.warn) {
      console.warn("[Volato] Disabled in development");
    }
    return;
  }

  window.addEventListener("error", (event: ErrorEvent) => {
    post(
      config,
      serialize(event.error ?? event.message, {
        filename: event.filename || undefined,
        lineno: typeof event.lineno === "number" ? event.lineno : undefined,
        colno: typeof event.colno === "number" ? event.colno : undefined,
      }),
    );
  });
  window.addEventListener(
    "unhandledrejection",
    (event: PromiseRejectionEvent) => {
      post(config, serialize(event.reason));
    },
  );
}

/**
 * React component that boots the Volato browser SDK once per page load.
 * Renders nothing. Drop it inside the root layout — keep it as low in the
 * tree as possible without losing coverage.
 *
 *   <VolatoBootstrap dsn={process.env.NEXT_PUBLIC_VOLATO_DSN!} />
 */
export function VolatoBootstrap(props: VolatoConfig): null {
  useEffect(() => {
    if (!props.dsn) return;
    initClient(props);
  }, [props.dsn, props.environment, props.projectId]);
  return null;
}

export type InstrumentFetchOptions = {
  /**
   * Lowest HTTP status that counts as a failure. Default: 500.
   */
  captureStatusFrom?: number;
  /**
   * Predicate that decides whether a request should be captured at all.
   */
  shouldCapture?: (url: string) => boolean;
};

let originalFetch: typeof fetch | null = null;

/**
 * Monkey-patch `window.fetch` to capture network failures (thrown errors)
 * and bad responses (HTTP status >= `captureStatusFrom`). Idempotent.
 */
export function instrumentFetch(options: InstrumentFetchOptions = {}): void {
  if (typeof window === "undefined") return;
  if (!isEnabled(activeConfig)) return;
  if (typeof fetch !== "function") return;
  if (originalFetch) return;

  const captureStatusFrom = options.captureStatusFrom ?? 500;
  const shouldCapture = options.shouldCapture ?? (() => true);
  originalFetch = fetch.bind(window);

  const wrapped: typeof fetch = async (input, init) => {
    const method = (init?.method ?? "GET").toUpperCase();
    const url = typeof input === "string" ? input : (input as Request).url;

    if (
      activeConfig &&
      activeConfig.dsn &&
      url.startsWith(dsnToIngestUrl(activeConfig.dsn))
    ) {
      return originalFetch!(input, init);
    }

    try {
      const res = await originalFetch!(input, init);
      if (
        res.status >= captureStatusFrom &&
        shouldCapture(url) &&
        isEnabled(activeConfig)
      ) {
        const synthetic = new Error(`HTTP ${res.status} ${method} ${url}`);
        synthetic.name = "FetchHttpError";
        post(activeConfig!, serialize(synthetic));
      }
      return res;
    } catch (err) {
      if (shouldCapture(url) && isEnabled(activeConfig)) {
        const reason = err instanceof Error ? err.message : String(err);
        const synthetic = new Error(
          `Network failure ${method} ${url}: ${reason}`,
        );
        synthetic.name = "FetchNetworkError";
        if (err instanceof Error && err.stack) synthetic.stack = err.stack;
        post(activeConfig!, serialize(synthetic));
      }
      throw err;
    }
  };

  window.fetch = wrapped;
}

/**
 * Wrap a client-invoked Server Action so any rejection is reported to Volato
 * before being re-thrown.
 */
export function wrapClientAction<T extends (...args: any[]) => any>(
  action: T,
  opts?: { name?: string },
): T {
  const wrapped = async function (
    this: unknown,
    ...args: Parameters<T>
  ): Promise<Awaited<ReturnType<T>>> {
    try {
      return await action.apply(this, args);
    } catch (err) {
      const inferred = (action as { name?: string }).name;
      const actionName = opts?.name ?? (inferred ? inferred : undefined);
      captureClientError(err, { actionName });
      throw err;
    }
  };
  return wrapped as unknown as T;
}

/**
 * Default ignore patterns for `instrumentConsole`. Filters the noisiest
 * dev-only React / Next.js warnings.
 */
export const DEFAULT_CONSOLE_IGNORE: readonly RegExp[] = [
  /Warning:.*key.*list/i,
  /Warning:.*hydration/i,
  /Warning:.*validateDOMNesting/i,
  /Warning:.*ReactDOM\.render is no longer supported/i,
  /Warning:.*useLayoutEffect does nothing on the server/i,
  /Warning:.*Each child in a list should have a unique/i,
];

export type ConsoleLevel = "error" | "warn";

export type InstrumentConsoleOptions = {
  levels?: ReadonlyArray<ConsoleLevel>;
  ignore?: readonly RegExp[];
};

let consoleOriginals:
  | Partial<Record<ConsoleLevel, typeof console.error>>
  | null = null;

function consoleArgsToMessage(args: readonly unknown[]): string {
  if (args.length === 0) return "";
  const first = args[0];
  if (typeof first === "string") return first;
  if (first instanceof Error) return first.message;
  try {
    return JSON.stringify(first);
  } catch {
    return String(first);
  }
}

/**
 * Monkey-patch `console.error` (and optionally `console.warn`) to forward
 * their first argument to Volato. Opt-in. Idempotent.
 */
export function instrumentConsole(
  options: InstrumentConsoleOptions = {},
): void {
  if (!isEnabled(activeConfig)) return;
  if (typeof console === "undefined") return;
  if (consoleOriginals) return;

  const levels: ReadonlyArray<ConsoleLevel> = options.levels ?? ["error"];
  const ignore = options.ignore ?? DEFAULT_CONSOLE_IGNORE;
  consoleOriginals = {};

  for (const level of levels) {
    const original = console[level];
    consoleOriginals[level] = original;
    console[level] = (...args: unknown[]) => {
      original.apply(console, args);
      try {
        const message = consoleArgsToMessage(args);
        if (!message) return;
        if (ignore.some((re) => re.test(message))) return;
        if (!isEnabled(activeConfig)) return;
        const syntheticName =
          level === "error" ? "ConsoleError" : "ConsoleWarning";
        const synthetic =
          args[0] instanceof Error
            ? args[0]
            : Object.assign(new Error(message), { name: syntheticName });
        post(activeConfig, serialize(synthetic));
      } catch {
        // Capturing console output must never break the host app.
      }
    };
  }
}

/** Test-only reset. Not exported from the package entrypoint. */
export function __resetActiveConfigForTests(): void {
  activeConfig = null;
  if (originalFetch && typeof window !== "undefined") {
    window.fetch = originalFetch;
  }
  originalFetch = null;
  if (consoleOriginals) {
    for (const [level, fn] of Object.entries(consoleOriginals)) {
      console[level as ConsoleLevel] = fn!;
    }
    consoleOriginals = null;
  }
}
