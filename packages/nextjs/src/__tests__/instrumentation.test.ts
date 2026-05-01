import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from "vitest";

import { onRequestError, register } from "../instrumentation";

const DSN = "https://volato.dev/secret_abc";

describe("onRequestError (Next.js 15 instrumentation hook)", () => {
  let fetchMock: Mock;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("VOLATO_DSN", DSN);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("maps routeType=render to runtime=rsc", async () => {
    await onRequestError(
      new Error("rsc boom"),
      { path: "/dashboard", method: "GET", headers: {} },
      {
        routerKind: "App Router",
        routePath: "/dashboard",
        routeType: "render",
      },
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(
      (fetchMock.mock.calls[0]![1] as RequestInit).body as string,
    ) as Record<string, unknown>;
    expect(body.runtime).toBe("rsc");
    expect(body.message).toBe("rsc boom");
    expect(body.route).toBe("/dashboard");
  });

  it("maps routeType=action to runtime=server_action", async () => {
    await onRequestError(
      new Error("action boom"),
      { path: "/api/x", method: "POST", headers: {} },
      {
        routerKind: "App Router",
        routePath: "/dashboard",
        routeType: "action",
      },
    );

    const body = JSON.parse(
      (fetchMock.mock.calls[0]![1] as RequestInit).body as string,
    ) as Record<string, unknown>;
    expect(body.runtime).toBe("server_action");
    expect(body.route).toBe("/dashboard");
  });

  it("maps routeType=route to runtime=route_handler", async () => {
    await onRequestError(
      new Error("route boom"),
      { path: "/api/foo", method: "GET", headers: {} },
      { routerKind: "App Router", routePath: "/api/foo", routeType: "route" },
    );

    const body = JSON.parse(
      (fetchMock.mock.calls[0]![1] as RequestInit).body as string,
    ) as Record<string, unknown>;
    expect(body.runtime).toBe("route_handler");
    expect(body.route).toBe("/api/foo");
  });

  it("maps routeType=middleware to runtime=middleware", async () => {
    await onRequestError(
      new Error("mw boom"),
      { path: "/protected", method: "GET", headers: {} },
      { routePath: "/middleware", routeType: "middleware" },
    );

    const body = JSON.parse(
      (fetchMock.mock.calls[0]![1] as RequestInit).body as string,
    ) as Record<string, unknown>;
    expect(body.runtime).toBe("middleware");
    expect(body.route).toBe("/middleware");
  });

  it("falls back to request.path when context.routePath is missing", async () => {
    await onRequestError(
      new Error("fallback"),
      { path: "/fallback-path", method: "GET", headers: {} },
      { routeType: "render" },
    );

    const body = JSON.parse(
      (fetchMock.mock.calls[0]![1] as RequestInit).body as string,
    ) as Record<string, unknown>;
    expect(body.route).toBe("/fallback-path");
  });

  it("forwards only whitelisted headers (cookies / auth never leak)", async () => {
    await onRequestError(
      new Error("headers"),
      {
        path: "/x",
        method: "GET",
        headers: {
          "user-agent": "vitest/1",
          referer: "https://example.com/from",
          "x-forwarded-for": "203.0.113.10",
          cookie: "session=supersecret",
          authorization: "Bearer shouldnotleak",
        },
      },
      { routeType: "render", routePath: "/x" },
    );

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

  it("no-ops when VOLATO_DSN is unset", async () => {
    vi.stubEnv("VOLATO_DSN", "");
    vi.spyOn(console, "warn").mockImplementation(() => {});

    await onRequestError(
      new Error("ignored"),
      { path: "/x", method: "GET", headers: {} },
      { routeType: "render", routePath: "/x" },
    );

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("swallows transport errors so the host app never crashes", async () => {
    fetchMock.mockRejectedValueOnce(new Error("network down"));
    await expect(
      onRequestError(
        new Error("boom"),
        { path: "/x", method: "GET", headers: {} },
        { routeType: "render", routePath: "/x" },
      ),
    ).resolves.toBeUndefined();
  });
});

describe("register", () => {
  it("is callable and returns nothing", () => {
    expect(register()).toBeUndefined();
  });
});
