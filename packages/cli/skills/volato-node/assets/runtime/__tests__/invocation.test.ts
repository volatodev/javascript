import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { withVolatoInvocation } from "../invocation";

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  process.env = {
    ...ORIGINAL_ENV,
    NODE_ENV: "production",
    VOLATO_DSN: "https://pk@api.volato.dev/project",
    VOLATO_RELEASE: "abcdef1234567",
  };
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function acceptedFetch(payloads: Array<Record<string, unknown>>) {
  return vi.fn(async (_url: unknown, init?: RequestInit) => {
    payloads.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    return { ok: true, status: 202 };
  });
}

describe("withVolatoInvocation", () => {
  it("preserves arguments, this, early return value, and emits nothing on success", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const receiver = { prefix: "kept" };
    const original = async function (this: typeof receiver, value: string) {
      return { owner: this.prefix, value };
    };
    const handler = withVolatoInvocation(original, {
      functionName: "handler",
    });

    const result = await handler.call(receiver, "result");

    expect(result).toEqual({ owner: "kept", value: "result" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    ["throw", (failure: Error) => async () => { throw failure; }],
    ["rejection", (failure: Error) => () => Promise.reject(failure)],
  ])("captures a handler %s once and rethrows the original value", async (_label, make) => {
    const payloads: Array<Record<string, unknown>> = [];
    vi.stubGlobal("fetch", acceptedFetch(payloads));
    const failure = new Error(`invocation-${_label}`);
    const handler = withVolatoInvocation(make(failure), {
      functionName: "checkout",
    });

    await expect(handler()).rejects.toBe(failure);
    expect(payloads).toHaveLength(1);
    expect(payloads[0]).toMatchObject({
      runtime: "node",
      capturedVia: "invocation",
      release: "abcdef1234567",
      contexts: { function: { name: "checkout" } },
    });
  });

  it("keeps Node HTTP context bounded and excludes request payloads", async () => {
    const payloads: Array<Record<string, unknown>> = [];
    vi.stubGlobal("fetch", acceptedFetch(payloads));
    const failure = new Error("private-http-failure");
    const handler = withVolatoInvocation(
      async (_request: unknown, response: { statusCode: number }) => {
        response.statusCode = 503;
        throw failure;
      },
      { functionName: "http-handler", http: true },
    );
    const request = {
      method: "POST",
      url: "/customers/private-user@example.com/orders/secret-42?token=hidden",
      id: "request-123",
      body: { card: "4242424242424242" },
      cookies: { session: "private-cookie" },
      headers: {
        "x-request-id": "header-request-id",
        authorization: "Bearer private-token",
      },
    };

    await expect(handler(request, { statusCode: 200 })).rejects.toBe(failure);

    expect(payloads[0]).toMatchObject({
      method: "POST",
      route: "/:segment/:segment/:segment/:segment",
      status: 503,
      requestId: "request-123",
    });
    const wire = JSON.stringify(payloads[0]);
    for (const privateValue of [
      "private-user@example.com",
      "secret-42",
      "hidden",
      "4242424242424242",
      "private-cookie",
      "private-token",
    ]) {
      expect(wire).not.toContain(privateValue);
    }
  });

  it("is safe across repeated initialization and concurrent warm reuse", async () => {
    const payloads: Array<Record<string, unknown>> = [];
    vi.stubGlobal("fetch", acceptedFetch(payloads));
    const beforeUncaught = process.listenerCount("uncaughtException");
    const beforeRejection = process.listenerCount("unhandledRejection");
    let sequence = 0;
    const original = async () => {
      sequence += 1;
      throw new Error(`warm-${sequence}`);
    };
    const first = withVolatoInvocation(original, { functionName: "warm" });
    const second = withVolatoInvocation(original, { functionName: "warm" });

    const settled = await Promise.allSettled([first(), second()]);

    expect(settled.every((result) => result.status === "rejected")).toBe(true);
    expect(payloads).toHaveLength(2);
    expect(process.listenerCount("uncaughtException")).toBe(beforeUncaught);
    expect(process.listenerCount("unhandledRejection")).toBe(beforeRejection);
  });

  it("deduplicates one failure across nested wrappers", async () => {
    const payloads: Array<Record<string, unknown>> = [];
    vi.stubGlobal("fetch", acceptedFetch(payloads));
    const failure = new Error("nested");
    const inner = withVolatoInvocation(async () => { throw failure; }, {
      functionName: "inner",
    });
    const outer = withVolatoInvocation(inner, { functionName: "outer" });

    await expect(outer()).rejects.toBe(failure);
    expect(payloads).toHaveLength(1);
  });

  it("bounds a stalled capture and still rethrows", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: unknown, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
        }),
      ),
    );
    const failure = new Error("timeout");
    const handler = withVolatoInvocation(async () => { throw failure; }, {
      functionName: "bounded",
      flushTimeoutMs: 20,
    });
    const started = Date.now();

    await expect(handler()).rejects.toBe(failure);
    expect(Date.now() - started).toBeLessThan(500);
  });

  it("reports missing configuration loudly and returns to the caller", async () => {
    delete process.env.VOLATO_DSN;
    const failure = new Error("missing-dsn");
    const handler = withVolatoInvocation(async () => { throw failure; }, {
      functionName: "missing",
    });

    await expect(handler()).rejects.toBe(failure);
    expect(console.error).toHaveBeenCalledWith(
      "[Volato] VOLATO_DSN is missing; Node capture is disabled.",
    );
  });
});
