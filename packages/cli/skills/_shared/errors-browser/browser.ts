type CaptureSource =
  | "window_error"
  | "unhandled_rejection"
  | "error_boundary"
  | "vue_error_handler"
  | "svelte_boundary"
  | "angular_error_handler"
  | "nuxt_app_error"
  | "sveltekit_client_handle_error"
  | "astro_hydration_error"
  | "manual";

export type BrowserCaptureContext = {
  componentStack?: string;
  capturedVia?: CaptureSource;
};

export type BrowserConfig = {
  dsn?: string;
  environment?: string;
  release?: string;
  enabled?: boolean;
};

declare const __VOLATO_BROWSER_CONFIG__: BrowserConfig | undefined;

const ATTEMPT_TIMEOUT_MS = 1_500;
let activeConfig: BrowserConfig | null = null;
let listenersAttached = false;
let warnedMissingDsn = false;
let capturedObjects = new WeakSet<object>();

function injectedConfig(): BrowserConfig {
  return typeof __VOLATO_BROWSER_CONFIG__ === "undefined"
    ? {}
    : (__VOLATO_BROWSER_CONFIG__ ?? {});
}

function effectiveConfig(config: BrowserConfig): BrowserConfig {
  const injected = injectedConfig();
  const environment =
    config.environment ?? injected.environment ?? "production";
  return {
    dsn: config.dsn ?? injected.dsn,
    release: config.release ?? injected.release,
    environment,
    enabled: config.enabled ?? injected.enabled ?? environment !== "development",
  };
}

function ingestUrl(dsn: string): string {
  const url = new URL(dsn);
  if (!/^https?:$/.test(url.protocol) || !url.username || url.password) {
    throw new Error("Invalid Volato DSN");
  }
  return `${url.origin}/api/ingest`;
}

function errorShape(value: unknown): {
  type: string;
  message: string;
  stack: string | null;
} {
  if (value instanceof Error) {
    return {
      type: value.name || "Error",
      message: value.message || "Unknown error",
      stack: value.stack ?? null,
    };
  }
  if (typeof value === "string") {
    return { type: "Error", message: value, stack: null };
  }
  if (value === null || value === undefined) {
    return { type: "Error", message: `Rejected with ${String(value)}`, stack: null };
  }
  if (typeof value === "object") {
    try {
      const record = value as Record<string, unknown>;
      const message = typeof record.message === "string" ? record.message : "";
      const type = typeof record.name === "string" ? record.name : "Error";
      const stack = typeof record.stack === "string" ? record.stack : null;
      if (message || stack) {
        return { type, message: message || "Unknown error", stack };
      }
    } catch {
      // A throwing property getter is still an opaque non-Error object.
    }
    return {
      type: "Error",
      message: "Rejected with non-Error object",
      stack: null,
    };
  }
  return {
    type: "Error",
    message: `Rejected with non-Error ${typeof value}`,
    stack: null,
  };
}

function alreadyCaptured(value: unknown): boolean {
  if ((typeof value !== "object" && typeof value !== "function") || value === null) {
    return false;
  }
  if (capturedObjects.has(value)) return true;
  capturedObjects.add(value);
  return false;
}

function currentRoute(): string | undefined {
  if (typeof location === "undefined") return undefined;
  const depth = location.pathname.split("/").filter(Boolean).length;
  return depth === 0
    ? "/"
    : `/${Array.from({ length: Math.min(depth, 64) }, () => ":segment").join("/")}`;
}

export async function captureBrowserError(
  value: unknown,
  context: BrowserCaptureContext = {},
): Promise<boolean> {
  const config = activeConfig;
  if (!config?.dsn || config.enabled === false || alreadyCaptured(value)) return false;
  const route = currentRoute();
  const payload = {
    v: 1,
    ...errorShape(value),
    runtime: "browser",
    timestamp: Date.now(),
    environment: config.environment ?? "production",
    release: config.release,
    commitSha:
      config.release && /^[a-f0-9]{7,40}$/i.test(config.release)
        ? config.release
        : undefined,
    route,
    url: route,
    userAgent:
      typeof navigator === "undefined" ? undefined : navigator.userAgent.slice(0, 2_048),
    componentStack: context.componentStack?.slice(0, 65_536),
    capturedVia: context.capturedVia ?? "manual",
    breadcrumbs: route
      ? [{ timestamp: Date.now(), type: "navigation", category: "route", message: route }]
      : undefined,
  };
  try {
    const response = await fetch(ingestUrl(config.dsn), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Volato-DSN": config.dsn,
      },
      body: JSON.stringify(payload),
      keepalive: true,
      signal: AbortSignal.timeout(ATTEMPT_TIMEOUT_MS),
    });
    if (!response.ok) {
      console.warn(`[Volato] Browser event rejected with HTTP ${response.status}.`);
      return false;
    }
    return true;
  } catch (error) {
    console.warn("[Volato] Browser event could not be delivered within 1500ms.", error);
    return false;
  }
}

function onWindowError(event: ErrorEvent): void {
  void captureBrowserError(event.error ?? event.message, {
    capturedVia: "window_error",
  });
}

function onUnhandledRejection(event: PromiseRejectionEvent): void {
  void captureBrowserError(event.reason, { capturedVia: "unhandled_rejection" });
}

export function initVolatoBrowser(config: BrowserConfig = {}): void {
  if (typeof window === "undefined") return;
  const resolved = effectiveConfig(config);
  if (!resolved.dsn) {
    if (!warnedMissingDsn) {
      warnedMissingDsn = true;
      console.error("[Volato] Browser DSN is missing; capture is disabled.");
    }
    return;
  }
  activeConfig = resolved;
  if (listenersAttached) return;
  listenersAttached = true;
  window.addEventListener("error", onWindowError);
  window.addEventListener("unhandledrejection", onUnhandledRejection);
}

export function __resetVolatoBrowserForTests(): void {
  if (listenersAttached && typeof window !== "undefined") {
    window.removeEventListener("error", onWindowError);
    window.removeEventListener("unhandledrejection", onUnhandledRejection);
  }
  activeConfig = null;
  listenersAttached = false;
  warnedMissingDsn = false;
  capturedObjects = new WeakSet<object>();
}
