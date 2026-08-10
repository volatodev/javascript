let activeConfig = { environment: "production", timeoutMs: 1_500 };
let handlersInstalled = false;

function configured(config = {}) {
  const environment =
    config.environment ?? process.env.VOLATO_ENVIRONMENT ?? process.env.NODE_ENV ?? "production";
  return {
    dsn: config.dsn ?? process.env.VOLATO_DSN,
    release: config.release ?? process.env.VOLATO_RELEASE,
    environment,
    enabled: config.enabled ?? environment !== "development",
    timeoutMs: config.timeoutMs ?? 1_500,
  };
}

function ingestUrl(dsn) {
  const url = new URL(dsn);
  if (!/^https?:$/.test(url.protocol) || !url.username || url.password) {
    throw new Error("Invalid VOLATO_DSN");
  }
  return `${url.origin}/api/ingest`;
}

function asError(value) {
  if (value instanceof Error) return value;
  if (typeof value === "string") return new Error(value);
  try {
    return new Error(JSON.stringify(value));
  } catch {
    return new Error(String(value));
  }
}

export async function captureNodeException(value, context = {}) {
  if (!activeConfig.dsn || activeConfig.enabled === false) return false;
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
  };
  try {
    const response = await fetch(ingestUrl(activeConfig.dsn), {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Volato-DSN": activeConfig.dsn },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(activeConfig.timeoutMs),
    });
    if (!response.ok) {
      console.warn(`[Volato] Node event rejected with HTTP ${response.status}.`);
      return false;
    }
    return true;
  } catch (deliveryError) {
    console.warn(`[Volato] Node event could not be delivered within ${activeConfig.timeoutMs}ms.`, deliveryError);
    return false;
  }
}

async function captureFatal(value, capturedVia) {
  const error = asError(value);
  await captureNodeException(error, { capturedVia });
  process.stderr.write(`${error.stack ?? error.message}\n`);
  process.exit(1);
}

export function initVolatoNode(config = {}) {
  activeConfig = configured(config);
  if (!activeConfig.dsn) {
    console.error("[Volato] VOLATO_DSN is missing; Node capture is disabled.");
    return;
  }
  if (handlersInstalled) return;
  handlersInstalled = true;
  if (process.listenerCount("uncaughtException") === 0) {
    process.once("uncaughtException", (error) => void captureFatal(error, "uncaught_exception"));
  } else {
    console.warn("[Volato] Existing uncaughtException handler detected; compose captureNodeException in that handler.");
  }
  if (process.listenerCount("unhandledRejection") === 0) {
    process.once("unhandledRejection", (reason) => void captureFatal(reason, "unhandled_rejection"));
  } else {
    console.warn("[Volato] Existing unhandledRejection handler detected; compose captureNodeException in that handler.");
  }
}
