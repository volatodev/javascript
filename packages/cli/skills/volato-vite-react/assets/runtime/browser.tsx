import React, { type ErrorInfo, type ReactNode, useEffect } from "react";

type CaptureSource =
  | "window_error"
  | "unhandled_rejection"
  | "error_boundary"
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

const ATTEMPT_TIMEOUT_MS = 1_500;
let activeConfig: BrowserConfig | null = null;
let listenersAttached = false;
let warnedMissingDsn = false;
const capturedObjects = new WeakSet<object>();

function envValue(name: "dsn" | "release" | "environment"): string | undefined {
  const env = import.meta.env as Record<string, unknown>;
  const value =
    name === "dsn"
      ? env.VITE_VOLATO_DSN
      : name === "release"
        ? env.VITE_VOLATO_RELEASE
        : env.VITE_VOLATO_ENVIRONMENT ?? env.MODE;
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function effectiveConfig(config: BrowserConfig): BrowserConfig {
  const environment = config.environment ?? envValue("environment") ?? "production";
  return {
    dsn: config.dsn ?? envValue("dsn"),
    release: config.release ?? envValue("release"),
    environment,
    enabled: config.enabled ?? environment !== "development",
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
  try {
    return { type: "Error", message: JSON.stringify(value).slice(0, 16_384), stack: null };
  } catch {
    return { type: "Error", message: String(value).slice(0, 16_384), stack: null };
  }
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
  return location.pathname.slice(0, 4_096);
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

export function initVolatoBrowser(config: BrowserConfig = {}): void {
  if (typeof window === "undefined") return;
  const resolved = effectiveConfig(config);
  if (!resolved.dsn) {
    if (!warnedMissingDsn) {
      warnedMissingDsn = true;
      console.error("[Volato] VITE_VOLATO_DSN is missing; browser capture is disabled.");
    }
    return;
  }
  activeConfig = resolved;
  if (listenersAttached) return;
  listenersAttached = true;
  window.addEventListener("error", (event) => {
    void captureBrowserError(event.error ?? event.message, {
      capturedVia: "window_error",
    });
  });
  window.addEventListener("unhandledrejection", (event) => {
    void captureBrowserError(event.reason, { capturedVia: "unhandled_rejection" });
  });
}

export function VolatoBootstrap(): null {
  useEffect(() => initVolatoBrowser(), []);
  return null;
}

type BoundaryProps = { children: ReactNode; fallback?: ReactNode };
type BoundaryState = { failed: boolean };

export class VolatoErrorBoundary extends React.Component<
  BoundaryProps,
  BoundaryState
> {
  state: BoundaryState = { failed: false };

  static getDerivedStateFromError(): BoundaryState {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    void captureBrowserError(error, {
      componentStack: info.componentStack ?? undefined,
      capturedVia: "error_boundary",
    });
  }

  render(): ReactNode {
    return this.state.failed ? (this.props.fallback ?? null) : this.props.children;
  }
}
