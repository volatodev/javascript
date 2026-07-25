import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from "vitest";
import { createTunnelHandler } from "../tunnel";

const DSN =
  "https://pk_test_abc@volato.dev/11111111-2222-3333-4444-555555555555";

let fetchMock: Mock;

function post(
  body = "{}",
  headers: Record<string, string> = {},
): Request {
  return new Request("https://app/monitoring", {
    method: "POST",
    body,
    headers: {
      "Content-Type": "application/json",
      "X-Volato-DSN": DSN,
      ...headers,
    },
  });
}

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("createTunnelHandler", () => {
  it("rejects non-POST methods with 405", async () => {
    vi.stubEnv("NEXT_PUBLIC_VOLATO_DSN", DSN);
    const handler = createTunnelHandler();
    const res = await handler(new Request("https://app/monitoring"));
    expect(res.status).toBe(405);
  });

  it("returns 500 when no DSN is configured", async () => {
    vi.stubEnv("NEXT_PUBLIC_VOLATO_DSN", "");
    const handler = createTunnelHandler();
    const res = await handler(post());
    expect(res.status).toBe(500);
  });

  it("returns 500 when DSN is malformed", async () => {
    const handler = createTunnelHandler({ dsn: "not-a-url" });
    const res = await handler(post());
    expect(res.status).toBe(500);
  });

  it("forwards body and DSN header to the ingest URL", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 202 }));
    const handler = createTunnelHandler({ dsn: DSN });

    const res = await handler(
      post('{"type":"Error"}', {
        Origin: "https://app.example.com",
        Referer: "https://app.example.com/page",
      }),
    );
    expect(res.status).toBe(202);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://volato.dev/api/ingest");
    expect((init.headers as Record<string, string>)["X-Volato-DSN"]).toBe(DSN);
    expect((init.headers as Record<string, string>).origin).toBe(
      "https://app.example.com",
    );
    expect((init.headers as Record<string, string>).referer).toBe(
      "https://app.example.com/page",
    );
    expect(init.body).toBe('{"type":"Error"}');
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("rejects a missing or mismatched DSN header", async () => {
    const handler = createTunnelHandler({ dsn: DSN });
    const missing = await handler(
      new Request("https://app/monitoring", {
        method: "POST",
        body: "{}",
        headers: { "Content-Type": "application/json" },
      }),
    );
    const mismatch = await handler(
      post("{}", {
        "X-Volato-DSN":
          "https://other@volato.dev/11111111-2222-3333-4444-555555555555",
      }),
    );

    expect(missing.status).toBe(400);
    expect(mismatch.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects non-JSON and oversized bodies before forwarding", async () => {
    const handler = createTunnelHandler({ dsn: DSN, maxBodyBytes: 5 });
    const wrongType = await handler(
      new Request("https://app/monitoring", {
        method: "POST",
        body: "{}",
        headers: { "Content-Type": "text/plain", "X-Volato-DSN": DSN },
      }),
    );
    const oversized = await handler(post("123456"));

    expect(wrongType.status).toBe(415);
    expect(oversized.status).toBe(413);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 502 if the upstream fetch throws", async () => {
    fetchMock.mockRejectedValueOnce(new Error("network down"));
    const handler = createTunnelHandler({ dsn: DSN });
    const res = await handler(post());
    expect(res.status).toBe(502);
  });

  it("aborts a stalled upstream request and returns 504", async () => {
    fetchMock.mockImplementationOnce(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          );
        }),
    );
    const handler = createTunnelHandler({ dsn: DSN, timeoutMs: 5 });

    const res = await handler(post());

    expect(res.status).toBe(504);
  });
});
