import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from "vitest";

import { __resetActiveConfigForTests, initClient } from "../client";
import { captureFromErrorBoundary } from "../error-boundary";

describe("captureFromErrorBoundary (Next.js error.tsx file boundary)", () => {
  let fetchMock: Mock;

  beforeEach(() => {
    __resetActiveConfigForTests();
    fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("window", { addEventListener: vi.fn() });
    vi.stubGlobal("location", { href: "https://app.example.com/page" });
    vi.stubGlobal("navigator", { userAgent: "vitest-agent/1.0" });
    vi.stubEnv("NODE_ENV", "production");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("forwards Next.js error.digest so client/server captures correlate", () => {
    initClient({
      dsn: "https://pk_test_abc@volato.dev/11111111-2222-3333-4444-555555555555",
      environment: "production",
    });

    const err = Object.assign(new Error("server-rendered boom"), {
      digest: "DIG_a1b2c3",
    });
    captureFromErrorBoundary(err);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(
      (fetchMock.mock.calls[0]![1] as RequestInit).body as string,
    ) as Record<string, unknown>;
    expect(body.message).toBe("server-rendered boom");
    expect(body.digest).toBe("DIG_a1b2c3");
    expect(body.runtime).toBe("client");
  });

  it("accepts an optional componentStack passthrough", () => {
    initClient({
      dsn: "https://pk_test_abc@volato.dev/11111111-2222-3333-4444-555555555555",
      environment: "production",
    });

    captureFromErrorBoundary(new Error("rendered"), {
      componentStack: "\n    at A\n    at B",
    });

    const body = JSON.parse(
      (fetchMock.mock.calls[0]![1] as RequestInit).body as string,
    ) as Record<string, unknown>;
    expect(body.componentStack).toBe("\n    at A\n    at B");
  });
});
