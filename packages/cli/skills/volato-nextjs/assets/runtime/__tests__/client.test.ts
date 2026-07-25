import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from "vitest";

import {
  __resetActiveConfigForTests,
  getCurrentScope,
  initClient,
  instrumentConsole,
  instrumentFetch,
  wrapClientAction,
} from "../client";
import { dsnToIngestUrl } from "../protocol";

type StoredListener = (event: unknown) => void;

type MockWindow = {
  addEventListener: Mock<(type: string, cb: StoredListener) => void>;
};

function makeMockWindow(): {
  window: MockWindow;
  listeners: Map<string, StoredListener[]>;
} {
  const listeners = new Map<string, StoredListener[]>();
  const window: MockWindow = {
    addEventListener: vi.fn((type: string, cb: StoredListener) => {
      const bucket = listeners.get(type) ?? [];
      bucket.push(cb);
      listeners.set(type, bucket);
    }),
  };
  return { window, listeners };
}

const PROJECT_ID = "11111111-2222-3333-4444-555555555555";
const DSN = `https://pk_test_abc@volato.dev/${PROJECT_ID}`;

describe("dsnToIngestUrl", () => {
  it("maps a DSN to the /api/ingest endpoint on the same origin", () => {
    expect(dsnToIngestUrl(DSN)).toBe("https://volato.dev/api/ingest");
  });

  it("strips userinfo and projectId from the DSN when computing the ingest URL", () => {
    expect(
      dsnToIngestUrl(`https://pk_eu@eu.volato.dev/${PROJECT_ID}`),
    ).toBe("https://eu.volato.dev/api/ingest");
  });
});

describe("initClient", () => {
  let fetchMock: Mock;

  beforeEach(() => {
    __resetActiveConfigForTests();
    fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("location", {
      href: "https://app.example.com/dashboard",
      origin: "https://app.example.com",
    });
    vi.stubGlobal("navigator", { userAgent: "vitest-agent/1.0" });
    vi.stubEnv("NODE_ENV", "production");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("no-ops when window is undefined (SSR)", () => {
    expect(typeof (globalThis as { window?: unknown }).window).toBe(
      "undefined",
    );
    expect(() => initClient({ dsn: DSN })).not.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("no-ops when no DSN is provided", () => {
    const { window } = makeMockWindow();
    vi.stubGlobal("window", window);

    initClient({ dsn: "" });

    expect(window.addEventListener).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("logs a loud one-shot console.error when DSN is missing", () => {
    const { window } = makeMockWindow();
    vi.stubGlobal("window", window);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    initClient({ dsn: "" });
    initClient({ dsn: "" });

    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0]?.[0]).toContain("[Volato]");
    expect(errorSpy.mock.calls[0]?.[0]).toContain("NEXT_PUBLIC_VOLATO_DSN");

    errorSpy.mockRestore();
  });

  it("sends the expected payload shape when a window error fires", () => {
    const { window, listeners } = makeMockWindow();
    vi.stubGlobal("window", window);

    initClient({ dsn: DSN, environment: "production" });

    const errorListener = listeners.get("error")?.[0];
    expect(errorListener).toBeTypeOf("function");

    const boom = new Error("boom");
    errorListener!({ error: boom, message: boom.message } as ErrorEvent);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://volato.dev/api/ingest");
    expect(options.method).toBe("POST");
    expect(options.keepalive).toBe(true);
    expect((options.headers as Record<string, string>)["Content-Type"]).toBe(
      "application/json",
    );
    expect((options.headers as Record<string, string>)["X-Volato-DSN"]).toBe(
      DSN,
    );

    const body = JSON.parse(options.body as string) as Record<string, unknown>;
    expect(body).toMatchObject({
      type: "Error",
      message: "boom",
      runtime: "client",
      url: "https://app.example.com/dashboard",
      userAgent: "vitest-agent/1.0",
    });
    expect(typeof body.stack).toBe("string");
    expect(typeof body.timestamp).toBe("number");
  });

  it("uses a same-origin tunnel only after explicit opt-in", () => {
    const { window, listeners } = makeMockWindow();
    vi.stubGlobal("window", window);
    initClient({
      dsn: DSN,
      environment: "production",
      tunnel: "/monitoring",
    });

    listeners.get("error")?.[0]?.({
      error: new Error("boom"),
      message: "boom",
    } as ErrorEvent);

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://app.example.com/monitoring",
    );
  });

  it("scrubs sensitive query params from the captured event.url (location.href)", () => {
    const { window, listeners } = makeMockWindow();
    vi.stubGlobal("window", window);
    vi.stubGlobal("location", {
      href: "https://app.example.com/dashboard?email=alice@example.com&page=2",
    });

    initClient({ dsn: DSN, environment: "production", tunnel: false });

    const errorListener = listeners.get("error")?.[0]!;
    errorListener({ error: new Error("boom"), message: "boom" } as ErrorEvent);

    const body = JSON.parse(
      (fetchMock.mock.calls[0]![1] as RequestInit).body as string,
    ) as Record<string, unknown>;
    expect(body.url).toBe(
      "https://app.example.com/dashboard?email=[FILTERED]&page=2",
    );
  });

  it("includes filename/lineno/colno from the ErrorEvent when present", () => {
    const { window, listeners } = makeMockWindow();
    vi.stubGlobal("window", window);

    initClient({ dsn: DSN, environment: "production" });

    const errorListener = listeners.get("error")?.[0];
    errorListener!({
      error: new Error("scripty"),
      message: "scripty",
      filename: "https://app.example.com/_next/static/chunks/main.js",
      lineno: 42,
      colno: 7,
    } as ErrorEvent);

    const body = JSON.parse(
      (fetchMock.mock.calls[0]![1] as RequestInit).body as string,
    ) as Record<string, unknown>;
    expect(body.filename).toBe(
      "https://app.example.com/_next/static/chunks/main.js",
    );
    expect(body.lineno).toBe(42);
    expect(body.colno).toBe(7);
  });

  it("sends payload when unhandledrejection fires", () => {
    const { window, listeners } = makeMockWindow();
    vi.stubGlobal("window", window);

    initClient({ dsn: DSN, environment: "production" });

    const rejectionListener = listeners.get("unhandledrejection")?.[0];
    expect(rejectionListener).toBeTypeOf("function");

    const rejection = new Error("promise rejected");
    rejectionListener!({ reason: rejection } as PromiseRejectionEvent);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(
      (fetchMock.mock.calls[0]![1] as RequestInit).body as string,
    ) as Record<string, unknown>;
    expect(body.message).toBe("promise rejected");
    expect(body.runtime).toBe("client");
  });

  it("normalizes a Promise.reject(undefined) into a tagged synthetic error", () => {
    const { window, listeners } = makeMockWindow();
    vi.stubGlobal("window", window);
    initClient({ dsn: DSN, environment: "production" });

    const rejectionListener = listeners.get("unhandledrejection")?.[0]!;
    rejectionListener({ reason: undefined } as PromiseRejectionEvent);

    const body = JSON.parse(
      (fetchMock.mock.calls[0]![1] as RequestInit).body as string,
    ) as Record<string, unknown>;
    expect(body.message).toBe("Rejected with undefined");
    expect(body.type).toBe("Error");
    expect(body.stack).toBeNull();
  });

  it("normalizes a Promise.reject(null) into a tagged synthetic error", () => {
    const { window, listeners } = makeMockWindow();
    vi.stubGlobal("window", window);
    initClient({ dsn: DSN, environment: "production" });

    const rejectionListener = listeners.get("unhandledrejection")?.[0]!;
    rejectionListener({ reason: null } as PromiseRejectionEvent);

    const body = JSON.parse(
      (fetchMock.mock.calls[0]![1] as RequestInit).body as string,
    ) as Record<string, unknown>;
    expect(body.message).toBe("Rejected with null");
  });

  it("extracts message/name/stack from an Error-shaped duck", () => {
    const { window, listeners } = makeMockWindow();
    vi.stubGlobal("window", window);
    initClient({ dsn: DSN, environment: "production" });

    const rejectionListener = listeners.get("unhandledrejection")?.[0]!;
    rejectionListener({
      reason: {
        name: "ValidationError",
        message: "name is required",
        stack: "ValidationError: name is required\n    at form.tsx:12",
      },
    } as PromiseRejectionEvent);

    const body = JSON.parse(
      (fetchMock.mock.calls[0]![1] as RequestInit).body as string,
    ) as Record<string, unknown>;
    expect(body.type).toBe("ValidationError");
    expect(body.message).toBe("name is required");
    expect(body.stack).toMatch(/form\.tsx:12/);
  });

  it("JSON-stringifies a plain-object rejection with no Error-like fields", () => {
    const { window, listeners } = makeMockWindow();
    vi.stubGlobal("window", window);
    initClient({ dsn: DSN, environment: "production" });

    const rejectionListener = listeners.get("unhandledrejection")?.[0]!;
    rejectionListener({
      reason: { code: 500, retryable: false },
    } as PromiseRejectionEvent);

    const body = JSON.parse(
      (fetchMock.mock.calls[0]![1] as RequestInit).body as string,
    ) as Record<string, unknown>;
    expect(body.message).toContain("500");
    expect(body.message).toContain("retryable");
  });

  it("is a no-op when NODE_ENV=development and no environment override is set", () => {
    vi.stubEnv("NODE_ENV", "development");
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { window, listeners } = makeMockWindow();
    vi.stubGlobal("window", window);

    initClient({ dsn: DSN });

    expect(window.addEventListener).not.toHaveBeenCalled();
    expect(listeners.size).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith("[Volato] Disabled in development");
  });

  it("ships events when NODE_ENV=development but environment='production' override is set", () => {
    vi.stubEnv("NODE_ENV", "development");
    const { window, listeners } = makeMockWindow();
    vi.stubGlobal("window", window);

    initClient({ dsn: DSN, environment: "production" });

    const errorListener = listeners.get("error")?.[0];
    expect(errorListener).toBeTypeOf("function");
    errorListener!({
      error: new Error("prod-override"),
      message: "prod-override",
    } as ErrorEvent);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("propagates scope breadcrumbs into the captured event payload", () => {
    // E2E: a breadcrumb added to the scope (auto-instrumentation,
    // user-driven addBreadcrumb, …) must end up inside the wire
    // payload so the agent renderer can show it. This pins the generated
    // integration ↔ HTTP protocol ↔ agent API contract.
    const { window, listeners } = makeMockWindow();
    vi.stubGlobal("window", window);

    initClient({ dsn: DSN, environment: "production", tunnel: false });

    getCurrentScope().addBreadcrumb({
      category: "fetch",
      level: "error",
      data: { url: "/api/users", method: "GET", status: 500, duration_ms: 42 },
    });
    getCurrentScope().addBreadcrumb({
      category: "navigation",
      data: { from: "/", to: "/users" },
    });

    const errorListener = listeners.get("error")?.[0];
    errorListener!({
      error: new Error("with-crumbs"),
      message: "with-crumbs",
    } as ErrorEvent);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(
      (fetchMock.mock.calls[0]![1] as RequestInit).body as string,
    ) as Record<string, unknown>;

    expect(Array.isArray(body.breadcrumbs)).toBe(true);
    const crumbs = body.breadcrumbs as Array<Record<string, unknown>>;
    expect(crumbs).toHaveLength(2);
    expect(crumbs[0]).toMatchObject({
      category: "fetch",
      level: "error",
      data: { url: "/api/users", status: 500 },
    });
    expect(crumbs[1]).toMatchObject({
      category: "navigation",
      data: { from: "/", to: "/users" },
    });
  });
});

describe("instrumentFetch", () => {
  let upstreamFetch: Mock;

  function getWindowFetch(): typeof fetch {
    return (globalThis as { window: { fetch: typeof fetch } }).window.fetch;
  }

  function lastIngestBody(): Record<string, unknown> {
    const calls = upstreamFetch.mock.calls.filter((c) => {
      const url = typeof c[0] === "string" ? c[0] : (c[0] as Request).url;
      return url.startsWith("https://volato.dev/api/ingest");
    });
    expect(calls.length).toBeGreaterThan(0);
    const init = calls[calls.length - 1]![1] as RequestInit;
    return JSON.parse(init.body as string) as Record<string, unknown>;
  }

  beforeEach(() => {
    __resetActiveConfigForTests();
    upstreamFetch = vi.fn();
    const win = { addEventListener: vi.fn(), fetch: upstreamFetch };
    vi.stubGlobal("window", win);
    vi.stubGlobal("fetch", upstreamFetch);
    vi.stubGlobal("location", { href: "https://app.example.com/" });
    vi.stubGlobal("navigator", { userAgent: "vitest" });
    vi.stubEnv("NODE_ENV", "production");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("captures a synthetic FetchHttpError when a 5xx is returned", async () => {
    upstreamFetch.mockImplementation(async (input: string | Request) => {
      const url = typeof input === "string" ? input : input.url;
      if (url.startsWith("https://volato.dev/api/ingest")) {
        return new Response(null, { status: 202 });
      }
      return new Response(null, { status: 503 });
    });

    initClient({ dsn: DSN, environment: "production", tunnel: false });
    instrumentFetch();

    const res = await getWindowFetch()("https://api.example.com/users");
    expect(res.status).toBe(503);

    const body = lastIngestBody();
    expect(body.type).toBe("FetchHttpError");
    expect(body.message).toContain("503");
    expect(body.message).toContain("https://api.example.com/users");
  });

  it("does not capture 4xx by default (captureStatusFrom defaults to 500)", async () => {
    upstreamFetch.mockImplementation(
      async () => new Response(null, { status: 404 }),
    );

    initClient({ dsn: DSN, environment: "production", tunnel: false });
    instrumentFetch();

    await getWindowFetch()("https://api.example.com/x");
    const ingestCalls = upstreamFetch.mock.calls.filter((c) => {
      const url = typeof c[0] === "string" ? c[0] : (c[0] as Request).url;
      return url.startsWith("https://volato.dev/api/ingest");
    });
    expect(ingestCalls.length).toBe(0);
  });

  it("captures a thrown network error and re-throws to the caller", async () => {
    upstreamFetch.mockImplementation(async (input: string | Request) => {
      const url = typeof input === "string" ? input : input.url;
      if (url.startsWith("https://volato.dev/api/ingest")) {
        return new Response(null, { status: 202 });
      }
      throw new TypeError("Failed to fetch");
    });

    initClient({ dsn: DSN, environment: "production", tunnel: false });
    instrumentFetch();

    await expect(
      getWindowFetch()("https://api.example.com/y", { method: "POST" }),
    ).rejects.toThrow("Failed to fetch");

    const body = lastIngestBody();
    expect(body.type).toBe("FetchNetworkError");
    expect(body.message).toContain("POST");
    expect(body.message).toContain("https://api.example.com/y");
  });

  it("does not loop-capture its own ingest traffic", async () => {
    upstreamFetch.mockImplementation(
      async () => new Response(null, { status: 503 }),
    );

    initClient({ dsn: DSN, environment: "production", tunnel: false });
    instrumentFetch();

    await getWindowFetch()("https://volato.dev/api/ingest", {
      method: "POST",
    });
    expect(upstreamFetch).toHaveBeenCalledTimes(1);
  });

  it("is idempotent (second call does not stack-wrap)", () => {
    initClient({ dsn: DSN, environment: "production", tunnel: false });
    instrumentFetch();
    const firstWrap = getWindowFetch();
    instrumentFetch();
    expect(getWindowFetch()).toBe(firstWrap);
  });

  it("scrubs the URL in FetchHttpError / FetchNetworkError synthetic messages", async () => {
    upstreamFetch.mockImplementation(async (input: string | Request) => {
      const url = typeof input === "string" ? input : input.url;
      if (url.startsWith("https://volato.dev/api/ingest")) {
        return new Response(null, { status: 202 });
      }
      return new Response(null, { status: 503 });
    });

    initClient({ dsn: DSN, environment: "production", tunnel: false });
    instrumentFetch();

    await getWindowFetch()(
      "https://api.example.com/users?email=alice@example.com&token=abc",
    );

    const body = lastIngestBody();
    expect(body.type).toBe("FetchHttpError");
    expect(body.message).toBe(
      "HTTP 503 GET https://api.example.com/users?email=[FILTERED]&token=[FILTERED]",
    );
  });

  it("scrubs the URL in the FetchNetworkError synthetic message", async () => {
    upstreamFetch.mockImplementation(async (input: string | Request) => {
      const url = typeof input === "string" ? input : input.url;
      if (url.startsWith("https://volato.dev/api/ingest")) {
        return new Response(null, { status: 202 });
      }
      throw new TypeError("Failed to fetch");
    });

    initClient({ dsn: DSN, environment: "production", tunnel: false });
    instrumentFetch();

    await expect(
      getWindowFetch()("https://api.example.com/y?token=abc", {
        method: "POST",
      }),
    ).rejects.toThrow("Failed to fetch");

    const body = lastIngestBody();
    expect(body.type).toBe("FetchNetworkError");
    expect(String(body.message)).toContain("token=[FILTERED]");
    expect(String(body.message)).not.toContain("token=abc");
  });

  it("scrubs sensitive query params in the fetch breadcrumb URL", async () => {
    upstreamFetch.mockImplementation(
      async () => new Response(null, { status: 200 }),
    );

    initClient({ dsn: DSN, environment: "production", tunnel: false });
    instrumentFetch();

    await getWindowFetch()(
      "https://api.example.com/users?email=alice@example.com&page=2",
    );

    const crumbs = getCurrentScope().breadcrumbs;
    const fetchCrumb = crumbs.find((c) => c.category === "fetch");
    expect(fetchCrumb?.data?.url).toBe(
      "https://api.example.com/users?email=[FILTERED]&page=2",
    );
  });
});

describe("wrapClientAction", () => {
  let fetchMock: Mock;

  beforeEach(() => {
    __resetActiveConfigForTests();
    fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("window", { addEventListener: vi.fn() });
    vi.stubGlobal("location", { href: "https://app.example.com/post/new" });
    vi.stubGlobal("navigator", { userAgent: "vitest" });
    vi.stubEnv("NODE_ENV", "production");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("captures with actionName + re-throws on rejection", async () => {
    initClient({ dsn: DSN, environment: "production" });

    async function createPost() {
      throw new Error("server action rejected");
    }
    const wrapped = wrapClientAction(createPost);

    await expect(wrapped()).rejects.toThrow("server action rejected");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(
      (fetchMock.mock.calls[0]![1] as RequestInit).body as string,
    ) as Record<string, unknown>;
    expect(body.message).toBe("server action rejected");
    expect(body.actionName).toBe("createPost");
    expect(body.runtime).toBe("client");
  });

  it("uses opts.name when the action is anonymous", async () => {
    initClient({ dsn: DSN, environment: "production" });
    const wrapped = wrapClientAction(
      async () => {
        throw new Error("anon");
      },
      { name: "submitForm" },
    );

    await expect(wrapped()).rejects.toThrow("anon");
    const body = JSON.parse(
      (fetchMock.mock.calls[0]![1] as RequestInit).body as string,
    ) as Record<string, unknown>;
    expect(body.actionName).toBe("submitForm");
  });

  it("does not capture when the action resolves", async () => {
    initClient({ dsn: DSN, environment: "production" });
    const wrapped = wrapClientAction(async () => 42);
    await expect(wrapped()).resolves.toBe(42);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("instrumentConsole", () => {
  let fetchMock: Mock;
  let originalConsoleError: typeof console.error;
  let originalConsoleWarn: typeof console.warn;

  beforeEach(() => {
    __resetActiveConfigForTests();
    originalConsoleError = console.error;
    originalConsoleWarn = console.warn;
    fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("window", { addEventListener: vi.fn() });
    vi.stubGlobal("location", { href: "https://app.example.com/" });
    vi.stubGlobal("navigator", { userAgent: "vitest" });
    vi.stubEnv("NODE_ENV", "production");
  });

  afterEach(() => {
    console.error = originalConsoleError;
    console.warn = originalConsoleWarn;
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("default mode adds a breadcrumb but does not POST an event", () => {
    initClient({ dsn: DSN, environment: "production" });
    instrumentConsole({ ignore: [] });

    console.error("something broke");

    expect(fetchMock).not.toHaveBeenCalled();
    const crumbs = getCurrentScope().breadcrumbs;
    expect(crumbs.length).toBe(1);
    expect(crumbs[0]).toMatchObject({
      category: "console",
      level: "error",
      message: "something broke",
    });
  });

  it("does not record console.warn breadcrumbs unless levels includes 'warn'", () => {
    initClient({ dsn: DSN, environment: "production" });
    instrumentConsole({ ignore: [] });

    console.warn("just a warning");
    expect(getCurrentScope().breadcrumbs.length).toBe(0);
  });

  it("records console.warn as a breadcrumb when levels=['error','warn']", () => {
    initClient({ dsn: DSN, environment: "production" });
    instrumentConsole({ levels: ["error", "warn"], ignore: [] });

    console.warn("interesting warning");
    const crumbs = getCurrentScope().breadcrumbs;
    expect(crumbs.length).toBe(1);
    expect(crumbs[0]).toMatchObject({
      category: "console",
      level: "warning",
      message: "interesting warning",
    });
  });

  it("filters out React key warnings via the default ignore list", () => {
    initClient({ dsn: DSN, environment: "production" });
    instrumentConsole();

    console.error(
      'Warning: Each child in a list should have a unique "key" prop.',
    );
    expect(fetchMock).not.toHaveBeenCalled();
    expect(getCurrentScope().breadcrumbs.length).toBe(0);
  });

  it("records an Error instance as a breadcrumb with its message", () => {
    initClient({ dsn: DSN, environment: "production" });
    instrumentConsole({ ignore: [] });

    const e = new TypeError("boom from console");
    console.error(e);

    expect(fetchMock).not.toHaveBeenCalled();
    const crumbs = getCurrentScope().breadcrumbs;
    expect(crumbs.length).toBe(1);
    expect(crumbs[0]?.message).toBe("boom from console");
  });

  it("still calls the underlying console method (does not swallow output)", () => {
    initClient({ dsn: DSN, environment: "production" });
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    instrumentConsole({ ignore: [] });

    console.error("visible message");

    expect(errSpy).toHaveBeenCalledWith("visible message");
  });

  it("is idempotent (second call does not stack-wrap)", () => {
    initClient({ dsn: DSN, environment: "production" });
    instrumentConsole({ ignore: [] });
    const firstWrap = console.error;
    instrumentConsole({ ignore: [] });
    expect(console.error).toBe(firstWrap);
  });
});

describe("bundle hygiene (dist/client.js)", () => {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const entryPath = resolve(__dirname, "../client.tsx");
  let bundle = "";

  beforeAll(async () => {
    const result = await build({
      entryPoints: [entryPath],
      bundle: true,
      format: "esm",
      platform: "browser",
      target: "es2022",
      external: ["react"],
      write: false,
    });
    bundle = result.outputFiles[0]?.text ?? "";
  });

  it("does not bundle any Node-only imports (crypto, fs, Buffer)", () => {
    expect(bundle).not.toMatch(/from\s*["']crypto["']/);
    expect(bundle).not.toMatch(/from\s*["']node:crypto["']/);
    expect(bundle).not.toMatch(/from\s*["']fs["']/);
    expect(bundle).not.toMatch(/from\s*["']node:fs["']/);
    expect(bundle).not.toMatch(/\bBuffer\b/);
  });
});
