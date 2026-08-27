export type NodeCaptureContext = {
  capturedVia?:
    | "manual"
    | "uncaught_exception"
    | "unhandled_rejection"
    | "express"
    | "invocation";
  method?: string;
  route?: string;
  status?: number;
  requestId?: string;
  functionName?: string;
};

export type NodeConfig = {
  dsn?: string;
  environment?: string;
  release?: string;
  enabled?: boolean;
  timeoutMs?: number;
  installFatalHandlers?: boolean;
};

let activeConfig: Required<Pick<NodeConfig, "environment" | "timeoutMs">> &
  NodeConfig = {
  environment: "production",
  timeoutMs: 1_500,
};
let handlersInstalled = false;
const capturedValues = new WeakSet<object>();

function configured(config: NodeConfig = {}): typeof activeConfig {
  const environment =
    config.environment ?? process.env.VOLATO_ENVIRONMENT ?? process.env.NODE_ENV ?? "production";
  return {
    dsn: config.dsn ?? process.env.VOLATO_DSN,
    release: config.release ?? process.env.VOLATO_RELEASE,
    environment,
    enabled: config.enabled ?? environment !== "development",
    timeoutMs: config.timeoutMs ?? 1_500,
    installFatalHandlers: config.installFatalHandlers ?? true,
  };
}

function ingestUrl(dsn: string): string {
  const url = new URL(dsn);
  if (!/^https?:$/.test(url.protocol) || !url.username || url.password) {
    throw new Error("Invalid VOLATO_DSN");
  }
  return `${url.origin}/api/ingest`;
}

function asError(value: unknown): Error {
  if (value instanceof Error) return value;
  if (typeof value === "string") return new Error(value);
  if (value === null || value === undefined) {
    return new Error(`Thrown ${String(value)}`);
  }
  if (typeof value === "object") {
    try {
      const record = value as Record<string, unknown>;
      const message = typeof record.message === "string" ? record.message : "";
      const stack = typeof record.stack === "string" ? record.stack : undefined;
      if (message || stack) {
        const error = new Error(message || "Unknown error");
        if (typeof record.name === "string") error.name = record.name;
        if (stack) error.stack = stack;
        return error;
      }
    } catch {
      // A throwing property getter is still an opaque non-Error object.
    }
    return new Error("Thrown non-Error object");
  }
  return new Error(`Thrown non-Error ${typeof value}`);
}

export async function captureNodeException(
  value: unknown,
  context: NodeCaptureContext = {},
): Promise<boolean> {
  if (!activeConfig.dsn || activeConfig.enabled === false) return false;
  if (
    (typeof value === "object" && value !== null) ||
    typeof value === "function"
  ) {
    if (capturedValues.has(value)) return false;
    capturedValues.add(value);
  }
  const error = asError(value);
  const release = activeConfig.release;
  const payload = {
    v: 1,
    type: error.name || "Error",
    message: (error.message || "Unknown error").slice(0, 16_384),
    stack: error.stack?.slice(0, 262_144) ?? null,
    runtime: "node",
    timestamp: Date.now(),
    environment: activeConfig.environment,
    release,
    commitSha: release && /^[a-f0-9]{7,40}$/i.test(release) ? release : undefined,
    capturedVia: context.capturedVia ?? "manual",
    method: context.method?.slice(0, 32),
    route: context.route?.slice(0, 4_096),
    status: context.status,
    requestId: context.requestId?.slice(0, 256),
    contexts: context.functionName
      ? { function: { name: context.functionName.slice(0, 256) } }
      : undefined,
  };
  try {
    const response = await fetch(ingestUrl(activeConfig.dsn), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Volato-DSN": activeConfig.dsn,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(activeConfig.timeoutMs),
    });
    if (!response.ok) {
      console.warn(`[Volato] Node event rejected with HTTP ${response.status}.`);
      return false;
    }
    return true;
  } catch (deliveryError) {
    console.warn(
      `[Volato] Node event could not be delivered within ${activeConfig.timeoutMs}ms.`,
      deliveryError,
    );
    return false;
  }
}

async function captureFatal(
  value: unknown,
  capturedVia: "uncaught_exception" | "unhandled_rejection",
): Promise<never> {
  const error = asError(value);
  await captureNodeException(error, { capturedVia });
  process.stderr.write(`${error.stack ?? error.message}\n`);
  process.exit(1);
}

export function initVolatoNode(config: NodeConfig = {}): void {
  activeConfig = configured(config);
  if (!activeConfig.dsn) {
    console.error("[Volato] VOLATO_DSN is missing; Node capture is disabled.");
    return;
  }
  if (activeConfig.installFatalHandlers === false) return;
  if (handlersInstalled) return;
  handlersInstalled = true;

  if (process.listenerCount("uncaughtException") === 0) {
    process.once("uncaughtException", (error) => {
      void captureFatal(error, "uncaught_exception");
    });
  } else {
    console.warn(
      "[Volato] Existing uncaughtException handler detected; compose captureNodeException in that handler to preserve its semantics.",
    );
  }
  if (process.listenerCount("unhandledRejection") === 0) {
    process.once("unhandledRejection", (reason) => {
      void captureFatal(reason, "unhandled_rejection");
    });
  } else {
    console.warn(
      "[Volato] Existing unhandledRejection handler detected; compose captureNodeException in that handler to preserve its semantics.",
    );
  }
}
