import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NextPageContext } from "next";
import { __resetActiveConfigForTests, initClient } from "../client";
import { withVolatoPagesError } from "../pages-error";

describe("withVolatoPagesError", () => {
  beforeEach(() => {
    __resetActiveConfigForTests();
    vi.stubGlobal("window", { addEventListener: vi.fn() });
    vi.stubGlobal("location", {
      href: "https://app.example.com/private?token=secret",
    });
    vi.stubGlobal("navigator", { userAgent: "vitest-agent/1.0" });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(null, { status: 202 })),
    );
    vi.stubEnv("NODE_ENV", "production");
    initClient({
      dsn: "https://pk_test@volato.dev/11111111-2222-3333-4444-555555555555",
      environment: "production",
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("reports a client transition error and delegates the existing data lifecycle", async () => {
    function ExistingError(_props: { statusCode: number }) {
      return null;
    }
    ExistingError.getInitialProps = vi
      .fn()
      .mockResolvedValue({ statusCode: 503 });
    const Wrapped = withVolatoPagesError(ExistingError);
    const error = new Error("pages render failed");

    const props = await Wrapped.getInitialProps?.({
      err: error,
      pathname: "/private",
      query: { token: "secret" },
    } as unknown as NextPageContext);

    expect(props).toEqual({ statusCode: 503 });
    expect(ExistingError.getInitialProps).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledTimes(1);
    const body = JSON.parse(
      (vi.mocked(fetch).mock.calls[0]![1] as RequestInit).body as string,
    ) as Record<string, unknown>;
    expect(body.message).toBe("pages render failed");
    expect(body.capturedVia).toBe("error_boundary");
    expect(JSON.stringify(body)).not.toContain("secret");
  });

  it("derives native status props when the component has no data lifecycle", async () => {
    const Wrapped = withVolatoPagesError(() => null);

    await expect(
      Wrapped.getInitialProps?.({
        res: { statusCode: 502 },
      } as unknown as NextPageContext),
    ).resolves.toEqual({ statusCode: 502 });
  });
});
