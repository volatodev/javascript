"use client";

import { useEffect } from "react";
import {
  dsnToIngestUrl,
  VOLATO_DSN_HEADER,
  type Breadcrumb,
  type Level,
  type User,
} from "@volatodev/core";
import {
  __resetHubForTests as __resetHub,
  getCurrentScope,
  withScope,
} from "./internal/hub-browser";
import { unwrapCauseChain } from "./internal/linked-errors";
import { applyReleaseTo } from "./internal/release";
import { runBeforeSend } from "./internal/before-send";
import {
  __resetDedupeForTests as __resetDedupe,
  shouldSend,
} from "./internal/dedupe";
import { shouldKeep } from "./internal/filters";
import { sendEnvelope } from "./internal/transport";
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
  linkedErrors?: ReturnType<typeof unwrapCauseChain>;
  release?: string;
  environment?: string;
  dist?: string;
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
  const chain = unwrapCauseChain(error);
  if (chain.length > 0) payload.linkedErrors = chain;
  const target = payload as unknown as Record<string, unknown>;
  if (activeConfig?.release) target.release = activeConfig.release;
  if (activeConfig?.dist) target.dist = activeConfig.dist;
  if (activeConfig?.environment) target.environment = activeConfig.environment;
  applyReleaseTo(target);
  getCurrentScope().applyTo(target);
  return payload;
}

function post(config: VolatoConfig, payload: ClientErrorPayload): void {
  if (typeof fetch === "undefined") return;
  const asEvent = payload as unknown as Record<string, unknown>;
  if (!shouldKeep(asEvent, config)) return;
  if (!shouldSend(asEvent)) return;
  const filtered = runBeforeSend(config.beforeSend, asEvent);
  if (filtered === null) return;
  void sendEnvelope(
    dsnToIngestUrl(config.dsn),
    { [VOLATO_DSN_HEADER]: config.dsn },
    JSON.stringify(filtered),
    { keepalive: true },
  );
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

    const startedAt = Date.now();
    try {
      const res = await originalFetch!(input, init);
      if (shouldCapture(url) && isEnabled(activeConfig)) {
        getCurrentScope().addBreadcrumb({
          category: "fetch",
          type: "http",
          level: res.status >= 400 ? "error" : "info",
          data: {
            url,
            method,
            status: res.status,
            duration_ms: Date.now() - startedAt,
          },
        });
      }
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
        getCurrentScope().addBreadcrumb({
          category: "fetch",
          type: "http",
          level: "error",
          data: {
            url,
            method,
            duration_ms: Date.now() - startedAt,
            error: err instanceof Error ? err.message : String(err),
          },
        });
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
  /**
   * - `"breadcrumb"` (default): each captured `console.*` call adds a
   *   breadcrumb to the active scope. Future captured events carry it
   *   in `breadcrumbs[]`. Cheap, no network traffic.
   * - `"event"`: each call also generates a standalone error event sent
   *   immediately to ingest. Use sparingly — `console.error` in a render
   *   loop generates one event per call.
   */
  mode?: "breadcrumb" | "event";
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
 * Monkey-patch `console.error` (and optionally `console.warn`) so each
 * call is recorded as a breadcrumb (default) or — when `mode: "event"` —
 * captured as a standalone event. Idempotent.
 */
export function instrumentConsole(
  options: InstrumentConsoleOptions = {},
): void {
  if (!isEnabled(activeConfig)) return;
  if (typeof console === "undefined") return;
  if (consoleOriginals) return;

  const levels: ReadonlyArray<ConsoleLevel> = options.levels ?? ["error"];
  const ignore = options.ignore ?? DEFAULT_CONSOLE_IGNORE;
  const mode = options.mode ?? "breadcrumb";
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

        getCurrentScope().addBreadcrumb({
          category: "console",
          level: level === "error" ? "error" : "warning",
          message,
          data: { arguments: args.length },
        });

        if (mode === "event") {
          const syntheticName =
            level === "error" ? "ConsoleError" : "ConsoleWarning";
          const synthetic =
            args[0] instanceof Error
              ? args[0]
              : Object.assign(new Error(message), { name: syntheticName });
          post(activeConfig, serialize(synthetic));
        }
      } catch {
        // Capturing console output must never break the host app.
      }
    };
  }
}

/* ─────────────────── Auto breadcrumbs: navigation ─────────────────── */

let navigationOriginals: {
  pushState?: typeof history.pushState;
  replaceState?: typeof history.replaceState;
  popHandler?: () => void;
} | null = null;

function recordNavigation(from: string, to: string): void {
  if (from === to) return;
  getCurrentScope().addBreadcrumb({
    category: "navigation",
    type: "navigation",
    data: { from, to },
  });
}

/**
 * Wrap `history.pushState` / `replaceState` and listen for `popstate` so
 * client-side navigations land in `breadcrumbs[]` as
 * `{ category: "navigation", data: { from, to } }`. Idempotent.
 */
export function instrumentNavigation(): void {
  if (typeof window === "undefined") return;
  if (navigationOriginals) return;
  if (!isEnabled(activeConfig)) return;

  const origPush = history.pushState.bind(history);
  const origReplace = history.replaceState.bind(history);
  navigationOriginals = { pushState: origPush, replaceState: origReplace };

  history.pushState = function (
    data: unknown,
    unused: string,
    url?: string | URL | null,
  ): void {
    const from = location.href;
    origPush(data, unused, url ?? null);
    recordNavigation(from, location.href);
  };
  history.replaceState = function (
    data: unknown,
    unused: string,
    url?: string | URL | null,
  ): void {
    const from = location.href;
    origReplace(data, unused, url ?? null);
    recordNavigation(from, location.href);
  };

  let lastUrl = location.href;
  const popHandler = (): void => {
    const from = lastUrl;
    lastUrl = location.href;
    recordNavigation(from, lastUrl);
  };
  navigationOriginals.popHandler = popHandler;
  window.addEventListener("popstate", popHandler);
}

/* ────────────────────── Auto breadcrumbs: clicks ────────────────────── */

const INTERACTIVE_TAGS = new Set([
  "BUTTON",
  "A",
  "INPUT",
  "SELECT",
  "TEXTAREA",
  "SUMMARY",
]);

let clickHandler: ((ev: Event) => void) | null = null;

function describeTarget(el: Element): string {
  const tag = el.tagName.toLowerCase();
  const id = el.id ? `#${el.id}` : "";
  const cls =
    el.classList && el.classList.length > 0
      ? `.${Array.from(el.classList).slice(0, 3).join(".")}`
      : "";
  return `${tag}${id}${cls}`;
}

/**
 * Add a breadcrumb each time the user clicks an interactive element
 * (button, link, form input). Records the element selector, not the text
 * inside — text often contains user-typed PII.
 */
export function instrumentClicks(): void {
  if (typeof window === "undefined") return;
  if (clickHandler) return;
  if (!isEnabled(activeConfig)) return;

  clickHandler = (ev: Event) => {
    try {
      let node: Element | null = ev.target as Element | null;
      while (node && !INTERACTIVE_TAGS.has(node.tagName)) {
        node = node.parentElement;
      }
      if (!node) return;
      getCurrentScope().addBreadcrumb({
        category: "ui.click",
        message: describeTarget(node),
      });
    } catch {
      // never break the host app on a breadcrumb path
    }
  };
  window.addEventListener("click", clickHandler, { capture: true });
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
  if (navigationOriginals) {
    if (typeof history !== "undefined" && typeof window !== "undefined") {
      if (navigationOriginals.pushState) {
        history.pushState = navigationOriginals.pushState;
      }
      if (navigationOriginals.replaceState) {
        history.replaceState = navigationOriginals.replaceState;
      }
      if (navigationOriginals.popHandler) {
        window.removeEventListener("popstate", navigationOriginals.popHandler);
      }
    }
    navigationOriginals = null;
  }
  if (clickHandler) {
    if (typeof window !== "undefined") {
      window.removeEventListener("click", clickHandler, { capture: true });
    }
    clickHandler = null;
  }
  __resetHub();
  __resetDedupe();
}

/* ───────────────────────── Scope public API ───────────────────────── */

export { withScope, getCurrentScope };

export function setUser(user: User | null): void {
  getCurrentScope().setUser(user);
}

export function setTag(key: string, value: string): void {
  getCurrentScope().setTag(key, value);
}

export function setTags(tags: Record<string, string>): void {
  getCurrentScope().setTags(tags);
}

export function setContext(
  key: string,
  ctx: Record<string, unknown> | null,
): void {
  getCurrentScope().setContext(key, ctx);
}

export function setExtra(key: string, value: unknown): void {
  getCurrentScope().setExtra(key, value);
}

export function setLevel(level: Level): void {
  getCurrentScope().setLevel(level);
}

export function setFingerprint(fingerprint: string[]): void {
  getCurrentScope().setFingerprint(fingerprint);
}

export function addBreadcrumb(crumb: Partial<Breadcrumb>): void {
  getCurrentScope().addBreadcrumb(crumb);
}
