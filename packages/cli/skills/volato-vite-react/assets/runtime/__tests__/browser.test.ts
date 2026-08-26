// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  __resetVolatoBrowserForTests,
  captureBrowserError,
  initVolatoBrowser,
} from "../browser";

afterEach(() => {
  __resetVolatoBrowserForTests();
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
});

describe("private browser capture recipe", () => {
  it("captures only a value-free route shape and an opaque non-Error payload", async () => {
    const requests: Array<{ body: string }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        requests.push({ body: String(init.body) });
        return new Response(null, { status: 202 });
      }),
    );
    window.history.replaceState(
      {},
      "",
      "/accounts/private@example.com/orders/123?token=browser-secret",
    );
    initVolatoBrowser({
      dsn: "https://public@api.volato.dev/project",
      environment: "production",
      release: "abcdef1234567",
    });

    await expect(
      captureBrowserError({
        email: "private@example.com",
        token: "browser-secret",
      }),
    ).resolves.toBe(true);

    expect(requests).toHaveLength(1);
    const payload = JSON.parse(requests[0]!.body) as Record<string, unknown>;
    expect(payload).toMatchObject({
      runtime: "browser",
      route: "/:segment/:segment/:segment/:segment",
      url: "/:segment/:segment/:segment/:segment",
      message: "Rejected with non-Error object",
      capturedVia: "manual",
      release: "abcdef1234567",
      commitSha: "abcdef1234567",
    });
    expect(requests[0]!.body).not.toContain("private@example.com");
    expect(requests[0]!.body).not.toContain("browser-secret");
    expect(requests[0]!.body).not.toContain("token");
  });

  it("does not capture in development unless explicitly enabled", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    initVolatoBrowser({
      dsn: "https://public@api.volato.dev/project",
      environment: "development",
    });

    await expect(captureBrowserError(new Error("dev"))).resolves.toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("captures window errors and unhandled rejections without swallowing them", async () => {
    const bodies: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        bodies.push(String(init.body));
        return new Response(null, { status: 202 });
      }),
    );
    initVolatoBrowser({
      dsn: "https://public@api.volato.dev/project",
      environment: "production",
    });
    const windowError = new Error("window failure");
    const rejectionError = new Error("rejection failure");

    expect(
      window.dispatchEvent(new ErrorEvent("error", { error: windowError })),
    ).toBe(true);
    const rejection = new Event("unhandledrejection");
    Object.defineProperty(rejection, "reason", { value: rejectionError });
    expect(window.dispatchEvent(rejection)).toBe(true);
    await vi.waitFor(() => expect(bodies).toHaveLength(2));

    expect(bodies.map((body) => JSON.parse(body).capturedVia).sort()).toEqual([
      "unhandled_rejection",
      "window_error",
    ]);
  });
});
