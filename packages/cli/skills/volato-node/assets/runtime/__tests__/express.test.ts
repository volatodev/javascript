import { beforeEach, describe, expect, it, vi } from "vitest";
import { volatoExpressErrorHandler } from "../express";
import { initVolatoNode } from "../node";

function accepted(): Promise<Response> {
  return Promise.resolve(new Response(null, { status: 202 }));
}

beforeEach(() => {
  vi.restoreAllMocks();
  initVolatoNode({
    dsn: "https://public@api.volato.test/project",
    environment: "production",
    release: "express-runtime-test",
    installFatalHandlers: false,
  });
});

describe("volatoExpressErrorHandler", () => {
  it("captures only normalized HTTP context and preserves the application handler", async () => {
    const fetchMock = vi.fn(accepted);
    vi.stubGlobal("fetch", fetchMock);
    const error = new Error("route failed") as Error & { customer?: unknown };
    error.customer = { email: "private@example.com" };
    const request = {
      method: "POST",
      baseUrl: "/private-tenant",
      route: { path: "/users/:userId" },
      id: "request-safe-123",
      originalUrl: "/api/users/private-user?token=query-secret",
      body: { password: "body-secret" },
      cookies: { session: "cookie-secret" },
      params: { userId: "private-user" },
      headers: { authorization: "header-secret" },
      get: vi.fn(() => "arbitrary-header-secret"),
    };
    const response = { statusCode: 422, headersSent: true };
    const next = vi.fn();

    await volatoExpressErrorHandler()(error, request, response, next);

    expect(next).toHaveBeenCalledOnce();
    expect(next).toHaveBeenCalledWith(error);
    expect(response).toEqual({ statusCode: 422, headersSent: true });
    const payload = JSON.parse(
      String((fetchMock.mock.calls[0]?.[1] as RequestInit).body),
    );
    expect(payload).toMatchObject({
      runtime: "node",
      capturedVia: "express",
      method: "POST",
      route: "/users/:userId",
      status: 422,
      requestId: "request-safe-123",
    });
    expect(JSON.stringify(payload)).not.toMatch(
      /private@example|private-tenant|private-user|query-secret|body-secret|cookie-secret|header-secret/,
    );
  });

  it("captures one primary event when the same Error crosses the adapter twice", async () => {
    const fetchMock = vi.fn(accepted);
    vi.stubGlobal("fetch", fetchMock);
    const error = new Error("same failure");
    const next = vi.fn();
    const middleware = volatoExpressErrorHandler();
    const request = { method: "GET", route: { path: "/boom" } };
    const response = { statusCode: 500 };

    await middleware(error, request, response, next);
    await middleware(error, request, response, next);

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(next).toHaveBeenCalledTimes(2);
    expect(next).toHaveBeenNthCalledWith(1, error);
    expect(next).toHaveBeenNthCalledWith(2, error);
  });

  it("always passes the original error onward when delivery fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const error = new Error("application failure");
    const next = vi.fn();

    await volatoExpressErrorHandler()(
      error,
      { method: "GET", route: { path: "/failure" } },
      { statusCode: 500 },
      next,
    );

    expect(next).toHaveBeenCalledOnce();
    expect(next).toHaveBeenCalledWith(error);
  });
});
