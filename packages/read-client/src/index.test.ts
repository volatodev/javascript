import { describe, expect, it, vi } from "vitest";
import { VolatoReadClient } from "./index";
import { runtimeSchema } from "./contracts";

describe("VolatoReadClient", () => {
  it("accepts the public Python runtime filter", () => {
    expect(runtimeSchema.parse("python")).toBe("python");
  });
  it("sends the bearer and validates a bounded projects response", async () => {
    const fetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer oauth-token");
      return Response.json({
        markdown: "No active projects.",
        data: { kind: "ok", projects: [], nextCursor: null },
      });
    });
    const client = new VolatoReadClient({
      baseUrl: "https://api.volato.dev/",
      accessToken: "oauth-token",
      fetch,
    });

    await expect(client.listProjects({ limit: 10 })).resolves.toEqual({
      markdown: "No active projects.",
      data: { kind: "ok", projects: [], nextCursor: null },
    });
    expect(fetch.mock.calls[0]?.[0]).toBe("https://api.volato.dev/v1/projects?limit=10");
  });

  it("turns stable API failures into typed read errors", async () => {
    const client = new VolatoReadClient({
      baseUrl: "https://api.volato.dev",
      accessToken: "revoked",
      fetch: vi.fn(async () =>
        Response.json(
          { error: "oauth_connection_revoked", message: "Reconnect Volato." },
          { status: 401, headers: { "Retry-After": "12" } },
        ),
      ),
    });

    await expect(client.listProjects()).rejects.toMatchObject({
      code: "oauth_connection_revoked",
      status: 401,
      retryAfter: 12,
    });
  });

  it("retries transient upstream failures with bounded backoff", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(Response.json({}, { status: 503 }))
      .mockResolvedValueOnce(
        Response.json({
          markdown: "Recovered.",
          data: { kind: "ok", projects: [], nextCursor: null },
        }),
      );
    const sleep = vi.fn(async () => undefined);
    const client = new VolatoReadClient({
      baseUrl: "https://api.volato.dev",
      accessToken: "oauth-token",
      fetch,
      sleep,
    });

    await expect(client.listProjects()).resolves.toMatchObject({
      markdown: "Recovered.",
    });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(250);
  });

  it("does not retry auth or rate-limit failures", async () => {
    const fetch = vi.fn(async () =>
      Response.json({ error: "rate_limited" }, { status: 429 }),
    );
    const client = new VolatoReadClient({
      baseUrl: "https://api.volato.dev",
      accessToken: "oauth-token",
      fetch,
      sleep: vi.fn(async () => undefined),
    });

    await expect(client.listProjects()).rejects.toMatchObject({
      code: "rate_limited",
      status: 429,
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
