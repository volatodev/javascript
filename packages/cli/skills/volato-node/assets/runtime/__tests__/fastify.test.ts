import { afterEach, describe, expect, it, vi } from "vitest";
import { initVolatoNode } from "../node";
import { volatoFastifyErrorHook } from "../fastify";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("volatoFastifyErrorHook", () => {
  it("captures bounded route context without replying or exposing request data", async () => {
    const bodies: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        bodies.push(String(init.body));
        return new Response(null, { status: 202 });
      }),
    );
    initVolatoNode({
      dsn: "https://public@api.volato.dev/project",
      installFatalHandlers: false,
    });
    const request = {
      method: "POST",
      id: "request-safe",
      routeOptions: { url: "/users/:userId" },
      body: { email: "private@example.com" },
      query: { token: "query-secret" },
      headers: { authorization: "header-secret" },
    };
    const reply = { statusCode: 422, send: vi.fn() };

    await volatoFastifyErrorHook()(request, reply, new Error("route failed"));

    expect(reply.send).not.toHaveBeenCalled();
    expect(bodies).toHaveLength(1);
    expect(JSON.parse(bodies[0]!)).toMatchObject({
      message: "route failed",
      capturedVia: "fastify",
      method: "POST",
      route: "/users/:userId",
      status: 422,
      requestId: "request-safe",
    });
    expect(bodies[0]).not.toMatch(
      /private@example\.com|query-secret|header-secret/,
    );
  });
});
