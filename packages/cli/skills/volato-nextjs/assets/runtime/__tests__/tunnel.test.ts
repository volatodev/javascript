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
    const res = await handler(
      new Request("https://app/monitoring", { method: "POST", body: "{}" }),
    );
    expect(res.status).toBe(500);
  });

  it("returns 500 when DSN is malformed", async () => {
    const handler = createTunnelHandler({ dsn: "not-a-url" });
    const res = await handler(
      new Request("https://app/monitoring", { method: "POST", body: "{}" }),
    );
    expect(res.status).toBe(500);
  });

  it("forwards body and DSN header to the ingest URL", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 202 }));
    const handler = createTunnelHandler({ dsn: DSN });

    const res = await handler(
      new Request("https://app/monitoring", {
        method: "POST",
        body: '{"type":"Error"}',
        headers: { "X-Volato-DSN": DSN },
      }),
    );
    expect(res.status).toBe(202);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://volato.dev/api/ingest");
    expect((init.headers as Record<string, string>)["X-Volato-DSN"]).toBe(DSN);
    expect(init.body).toBe('{"type":"Error"}');
  });

  it("synthesises the DSN header from the env DSN when the browser omitted it", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 202 }));
    vi.stubEnv("NEXT_PUBLIC_VOLATO_DSN", DSN);
    const handler = createTunnelHandler();

    await handler(
      new Request("https://app/monitoring", {
        method: "POST",
        body: "{}",
      }),
    );
    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    expect((init.headers as Record<string, string>)["X-Volato-DSN"]).toBe(DSN);
  });

  it("returns 502 if the upstream fetch throws", async () => {
    fetchMock.mockRejectedValueOnce(new Error("network down"));
    const handler = createTunnelHandler({ dsn: DSN });
    const res = await handler(
      new Request("https://app/monitoring", { method: "POST", body: "{}" }),
    );
    expect(res.status).toBe(502);
  });
});
