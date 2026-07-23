import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from "vitest";

import {
  captureException,
  reportActionError,
  wrapAction,
  wrapRoute,
} from "../server";

const DSN =
  "https://pk_test_abc@volato.dev/11111111-2222-3333-4444-555555555555";

describe("captureException (server / RSC)", () => {
  let fetchMock: Mock;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("NEXT_PUBLIC_VOLATO_DSN", DSN);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("posts an RSC payload with type/message/stack/route/runtime/timestamp", async () => {
    const boom = new TypeError("boom");
    await captureException(boom, { route: "/dashboard" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://volato.dev/api/ingest");
    expect(options.method).toBe("POST");
    const headers = options.headers as Record<string, string>;
    expect(headers["Content-Type"]).toBe("application/json");
    expect(headers["X-Volato-DSN"]).toBe(DSN);

    expect((options as { keepalive?: boolean }).keepalive).toBeUndefined();

    const body = JSON.parse(options.body as string) as Record<string, unknown>;
    expect(body).toMatchObject({
      type: "TypeError",
      message: "boom",
      runtime: "rsc",
      route: "/dashboard",
    });
    expect(typeof body.stack).toBe("string");
    expect((body.stack as string).length).toBeGreaterThan(0);
    expect(typeof body.timestamp).toBe("number");
  });

  it("only forwards whitelisted headers (cookies / auth never leak)", async () => {
    const headers = new Headers({
      "user-agent": "vitest/1",
      referer: "https://example.com/from",
      "x-forwarded-for": "203.0.113.10",
      cookie: "session=supersecret",
      authorization: "Bearer shouldnotleak",
    });

    await captureException(new Error("whatever"), { headers });

    const body = JSON.parse(
      (fetchMock.mock.calls[0]![1] as RequestInit).body as string,
    ) as { headers: Record<string, string> };

    expect(body.headers).toEqual({
      "user-agent": "vitest/1",
      referer: "https://example.com/from",
      "x-forwarded-for": "203.0.113.10",
    });
    expect(body.headers).not.toHaveProperty("cookie");
    expect(body.headers).not.toHaveProperty("authorization");
  });

  it("defaults route=null and headers={} when ctx is omitted", async () => {
    await captureException(new Error("ctxless"));
    const body = JSON.parse(
      (fetchMock.mock.calls[0]![1] as RequestInit).body as string,
    ) as Record<string, unknown>;

    expect(body.route).toBeNull();
    expect(body.headers).toEqual({});
  });

  it("serializes a string error into the message field", async () => {
    await captureException("just a string");
    const body = JSON.parse(
      (fetchMock.mock.calls[0]![1] as RequestInit).body as string,
    ) as Record<string, unknown>;

    expect(body.type).toBe("Error");
    expect(body.message).toBe("just a string");
    expect(body.stack).toBeNull();
  });

  it("warns and skips the POST when NEXT_PUBLIC_VOLATO_DSN is unset", async () => {
    vi.stubEnv("NEXT_PUBLIC_VOLATO_DSN", "");
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    await captureException(new Error("ignored"));

    expect(fetchMock).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(String(warnSpy.mock.calls[0]![0])).toMatch(/VOLATO_DSN/);
  });

  it("swallows fetch errors so the host app never crashes", async () => {
    fetchMock.mockRejectedValueOnce(new Error("network down"));
    await expect(captureException(new Error("boom"))).resolves.toBeUndefined();
  });

  it("scrubs sensitive query params from ctx.request url and searchParams", async () => {
    const req = new Request(
      "https://app.test/api/users?email=alice@example.com&token=abc&page=2",
      { method: "GET" },
    );
    await captureException(new Error("with query"), { request: req });

    const body = JSON.parse(
      (fetchMock.mock.calls[0]![1] as RequestInit).body as string,
    ) as {
      request: {
        url: string;
        pathname?: string;
        searchParams?: Record<string, string>;
      };
    };

    expect(body.request.url).toBe(
      "https://app.test/api/users?email=[FILTERED]&token=[FILTERED]&page=2",
    );
    expect(body.request.pathname).toBe("/api/users");
    expect(body.request.searchParams).toEqual({
      email: "[FILTERED]",
      token: "[FILTERED]",
      page: "2",
    });
  });
});

describe("wrapAction", () => {
  let fetchMock: Mock;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("NEXT_PUBLIC_VOLATO_DSN", DSN);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("does not capture when the action resolves", async () => {
    async function doWork(x: number, y: number) {
      return x + y;
    }
    const wrapped = wrapAction(doWork);

    const result = await wrapped(2, 3);

    expect(result).toBe(5);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("captures with runtime=server_action and re-throws the original error", async () => {
    const original = new Error("action kaboom");
    async function brokenAction() {
      throw original;
    }
    const wrapped = wrapAction(brokenAction);

    await expect(wrapped()).rejects.toBe(original);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(
      (fetchMock.mock.calls[0]![1] as RequestInit).body as string,
    ) as Record<string, unknown>;
    expect(body.runtime).toBe("server_action");
    expect(body.message).toBe("action kaboom");
    expect(body.route).toBe("brokenAction");
  });

  it("uses opts.name to override the inferred action.name", async () => {
    const broken = async () => {
      throw new Error("anonymous boom");
    };
    const wrapped = wrapAction(broken, { name: "createUser" });

    await expect(wrapped()).rejects.toThrow("anonymous boom");

    const body = JSON.parse(
      (fetchMock.mock.calls[0]![1] as RequestInit).body as string,
    ) as Record<string, unknown>;
    expect(body.route).toBe("createUser");
  });
});

describe("reportActionError", () => {
  let fetchMock: Mock;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("NEXT_PUBLIC_VOLATO_DSN", DSN);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("captures with runtime=server_action and the provided name", async () => {
    await reportActionError(new Error("returned-failure"), {
      name: "createPost",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(
      (fetchMock.mock.calls[0]![1] as RequestInit).body as string,
    ) as Record<string, unknown>;
    expect(body.runtime).toBe("server_action");
    expect(body.message).toBe("returned-failure");
    expect(body.route).toBe("createPost");
  });

  it("works without an opts.name (route stays null)", async () => {
    await reportActionError(new Error("nameless"));
    const body = JSON.parse(
      (fetchMock.mock.calls[0]![1] as RequestInit).body as string,
    ) as Record<string, unknown>;
    expect(body.runtime).toBe("server_action");
    expect(body.route).toBeNull();
  });

  it("does not throw — caller must be safe to await even if transport fails", async () => {
    fetchMock.mockRejectedValueOnce(new Error("network"));
    await expect(
      reportActionError(new Error("boom"), { name: "x" }),
    ).resolves.toBeUndefined();
  });
});

describe("wrapRoute", () => {
  let fetchMock: Mock;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("NEXT_PUBLIC_VOLATO_DSN", DSN);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("does not capture when the handler resolves", async () => {
    const handler = async (_req: Request) =>
      new Response("ok", { status: 200 });
    const wrapped = wrapRoute(handler);

    const res = await wrapped(new Request("https://app.test/api/foo"));

    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ok");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("captures with runtime=route_handler, the pathname, and whitelisted headers, then re-throws", async () => {
    const original = new Error("route kaboom");
    const handler = async (_req: Request) => {
      throw original;
    };
    const wrapped = wrapRoute(handler);

    const req = new Request("https://app.test/api/foo?x=1", {
      headers: {
        "user-agent": "vitest/1",
        referer: "https://example.com/from",
        "x-forwarded-for": "203.0.113.10",
        cookie: "session=supersecret",
        authorization: "Bearer shouldnotleak",
      },
    });

    await expect(wrapped(req)).rejects.toBe(original);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(
      (fetchMock.mock.calls[0]![1] as RequestInit).body as string,
    ) as { runtime: string; route: string; headers: Record<string, string> };

    expect(body.runtime).toBe("route_handler");
    expect(body.route).toBe("/api/foo");
    expect(body.headers).toEqual({
      "user-agent": "vitest/1",
      referer: "https://example.com/from",
      "x-forwarded-for": "203.0.113.10",
    });
    expect(body.headers).not.toHaveProperty("cookie");
    expect(body.headers).not.toHaveProperty("authorization");
  });
});

describe("wrapRoute — streamed Response error capture", () => {
  let fetchMock: Mock;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("NEXT_PUBLIC_VOLATO_DSN", DSN);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("captures a stream that rejects after the handler has returned", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("first chunk "));
        queueMicrotask(() => controller.error(new Error("stream kaboom")));
      },
    });

    const handler = async (_req: Request) =>
      new Response(stream, { status: 200 });
    const wrapped = wrapRoute(handler);

    const req = new Request("https://app.test/api/stream");
    const res = await wrapped(req);
    expect(res.status).toBe(200);

    const reader = res.body!.getReader();
    let drainErr: unknown = null;
    try {
      while (true) {
        const { done } = await reader.read();
        if (done) break;
      }
    } catch (err) {
      drainErr = err;
    }
    expect(drainErr).toBeTruthy();

    await new Promise((r) => setTimeout(r, 0));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(
      (fetchMock.mock.calls[0]![1] as RequestInit).body as string,
    ) as Record<string, unknown>;
    expect(body.runtime).toBe("route_handler");
    expect(body.message).toBe("stream kaboom");
    expect(body.route).toBe("/api/stream");
  });

  it("does not capture for a successful streamed response", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("ok"));
        controller.close();
      },
    });
    const handler = async (_req: Request) =>
      new Response(stream, { status: 200 });
    const wrapped = wrapRoute(handler);

    const res = await wrapped(new Request("https://app.test/api/stream"));
    expect(await res.text()).toBe("ok");

    await new Promise((r) => setTimeout(r, 0));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("passes through a body-less Response unchanged (no double-wrap)", async () => {
    const handler = async (_req: Request) =>
      new Response(null, { status: 204 });
    const wrapped = wrapRoute(handler);

    const res = await wrapped(new Request("https://app.test/api/empty"));
    expect(res.status).toBe(204);
    expect(res.body).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("generated server source hygiene", () => {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const sourcePath = resolve(__dirname, "../server.ts");

  it("does not import node:crypto", () => {
    const source = readFileSync(sourcePath, "utf8");
    expect(source).not.toMatch(/from\s*["']crypto["']/);
    expect(source).not.toMatch(/from\s*["']node:crypto["']/);
  });
});
