import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from "vitest";

import type { VolatoConfig } from "../index";
import {
  __resetHubForTests,
  captureException,
  wrapMiddleware,
} from "../middleware";

const DSN =
  "https://pk_test_abc@volato.dev/11111111-2222-3333-4444-555555555555";
const config: VolatoConfig = { dsn: DSN };

describe("captureException (middleware / Edge)", () => {
  let fetchMock: Mock;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("posts an Edge payload with runtime=middleware and the request url/method", async () => {
    const req = new Request("https://app.test/protected?x=1", {
      method: "POST",
    });
    const boom = new TypeError("boom");

    await captureException(boom, req, config);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://volato.dev/api/ingest");
    expect(options.method).toBe("POST");
    expect((options as { keepalive?: boolean }).keepalive).toBe(true);

    const headers = options.headers as Record<string, string>;
    expect(headers["Content-Type"]).toBe("application/json");
    expect(headers["X-Volato-DSN"]).toBe(DSN);

    const body = JSON.parse(options.body as string) as Record<string, unknown>;
    expect(body).toMatchObject({
      type: "TypeError",
      message: "boom",
      runtime: "middleware",
      url: "https://app.test/protected?x=1",
      method: "POST",
    });
    expect(typeof body.stack).toBe("string");
    expect((body.stack as string).length).toBeGreaterThan(0);
    expect(typeof body.timestamp).toBe("number");
  });

  it("attaches release and commit identities passed by the generated middleware snippet", async () => {
    const req = new Request("https://app.test/protected");

    await captureException(new Error("boom"), req, {
      ...config,
      release: "0123456789abcdef",
      commitSha: "fedcba9876543210",
    });

    const body = JSON.parse(
      (fetchMock.mock.calls[0]![1] as RequestInit).body as string,
    ) as Record<string, unknown>;
    expect(body.release).toBe("0123456789abcdef");
    expect(body.commitSha).toBe("fedcba9876543210");
  });

  it("coerces non-Error throws into an Error payload", async () => {
    const req = new Request("https://app.test/", { method: "GET" });

    await captureException("just a string", req, config);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(
      (fetchMock.mock.calls[0]![1] as RequestInit).body as string,
    ) as Record<string, unknown>;
    expect(body.type).toBe("Error");
    expect(body.message).toBe("just a string");
  });

  it("does not serialize arbitrary fields from a thrown object", async () => {
    const req = new Request("https://app.test/", { method: "GET" });

    await captureException(
      { email: "person@example.com", token: "secret-token" },
      req,
      config,
    );

    const serialized = (fetchMock.mock.calls[0]![1] as RequestInit)
      .body as string;
    const body = JSON.parse(serialized) as Record<string, unknown>;
    expect(body.message).toBe("Thrown non-Error object");
    expect(serialized).not.toContain("person@example.com");
    expect(serialized).not.toContain("secret-token");
  });

  it("scrubs sensitive query params from url and searchParams", async () => {
    const req = new Request(
      "https://app.test/protected?email=alice@example.com&token=abc&page=2",
      { method: "GET" },
    );
    await captureException(new Error("boom"), req, config);

    const body = JSON.parse(
      (fetchMock.mock.calls[0]![1] as RequestInit).body as string,
    ) as {
      url: string;
      request: { url: string; searchParams: Record<string, string> };
    };

    expect(body.url).toBe(
      "https://app.test/protected?email=[FILTERED]&token=[FILTERED]&page=2",
    );
    expect(body.request.url).toBe(
      "https://app.test/protected?email=[FILTERED]&token=[FILTERED]&page=2",
    );
    expect(body.request.searchParams).toEqual({
      email: "[FILTERED]",
      token: "[FILTERED]",
      page: "2",
    });
  });

  it("swallows fetch errors so the host app never crashes", async () => {
    fetchMock.mockRejectedValueOnce(new Error("network down"));
    const req = new Request("https://app.test/", { method: "GET" });

    await expect(
      captureException(new Error("boom"), req, config),
    ).resolves.toBeUndefined();
  });

  it("does not capture when the inlined environment is development", async () => {
    const req = new Request("https://app.test/");
    await captureException(new Error("local-only"), req, {
      ...config,
      environment: "development",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("captures the inlined development environment after an explicit opt-in", async () => {
    const req = new Request("https://app.test/");
    await captureException(new Error("local-opt-in"), req, {
      ...config,
      environment: "development",
      enabled: true,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("logs a loud one-shot console.error when DSN is missing and skips the network call", async () => {
    __resetHubForTests();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const req = new Request("https://app.test/", { method: "GET" });

    await captureException(new Error("boom"), req, { dsn: "" });
    await captureException(new Error("again"), req, { dsn: "" });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0]?.[0]).toContain("[Volato]");
    expect(errorSpy.mock.calls[0]?.[0]).toContain("NEXT_PUBLIC_VOLATO_DSN");

    errorSpy.mockRestore();
  });
});

describe("wrapMiddleware", () => {
  let fetchMock: Mock;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("does not capture when the middleware resolves and propagates the Response", async () => {
    const mw = async (_req: Request) => new Response("ok", { status: 200 });
    const wrapped = wrapMiddleware(mw, config);

    const res = await wrapped(new Request("https://app.test/protected"));

    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ok");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("captures with runtime=middleware and re-throws the original error", async () => {
    const original = new Error("middleware kaboom");
    const mw = async (_req: Request): Promise<Response> => {
      throw original;
    };
    const wrapped = wrapMiddleware(mw, config);

    const req = new Request("https://app.test/protected", { method: "GET" });
    await expect(wrapped(req)).rejects.toBe(original);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(
      (fetchMock.mock.calls[0]![1] as RequestInit).body as string,
    ) as Record<string, unknown>;
    expect(body.runtime).toBe("middleware");
    expect(body.message).toBe("middleware kaboom");
    expect(body.url).toBe("https://app.test/protected");
    expect(body.method).toBe("GET");
  });
});
