import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from "vitest";
import {
  __resetTransportForTests,
  sendEnvelope,
} from "../internal/transport";

let fetchMock: Mock;
let sleepCalls: number[];
const fastSleep = async (ms: number) => {
  sleepCalls.push(ms);
};

beforeEach(() => {
  __resetTransportForTests();
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  sleepCalls = [];
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const URL_ = "https://ingest.volato.dev/api/ingest";

describe("sendEnvelope — happy path", () => {
  it("sends one POST and resolves on 202", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 202 }));
    await sendEnvelope(URL_, { x: "y" }, '{"a":1}', { sleep: fastSleep });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    expect(init.method).toBe("POST");
    expect(init.body).toBe('{"a":1}');
    const headers = init.headers as Record<string, string>;
    expect(headers["Content-Type"]).toBe("application/json");
    expect(headers.x).toBe("y");
  });

  it("only adds keepalive when explicitly requested", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 202 }));
    await sendEnvelope(URL_, {}, "x", { sleep: fastSleep });
    let init = fetchMock.mock.calls[0]![1] as RequestInit;
    expect(init.keepalive).toBeUndefined();
    await sendEnvelope(URL_, {}, "x", { keepalive: true, sleep: fastSleep });
    init = fetchMock.mock.calls[1]![1] as RequestInit;
    expect(init.keepalive).toBe(true);
  });
});

describe("sendEnvelope — retry on 5xx", () => {
  it("retries up to maxRetries with exponential backoff", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(null, { status: 500 }))
      .mockResolvedValueOnce(new Response(null, { status: 502 }))
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(new Response(null, { status: 202 }));
    await sendEnvelope(URL_, {}, "x", {
      maxRetries: 3,
      baseBackoffMs: 100,
      sleep: fastSleep,
      random: () => 1,
    });
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(sleepCalls.length).toBe(3);
    expect(sleepCalls[0]).toBe(100);
    expect(sleepCalls[1]).toBe(200);
    expect(sleepCalls[2]).toBe(400);
  });

  it("gives up after maxRetries+1 attempts on persistent 500", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 500 }));
    await sendEnvelope(URL_, {}, "x", {
      maxRetries: 2,
      baseBackoffMs: 1,
      sleep: fastSleep,
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});

describe("sendEnvelope — 429 with Retry-After", () => {
  it("honours Retry-After in delta-seconds", async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response(null, {
          status: 429,
          headers: { "Retry-After": "2" },
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 202 }));
    await sendEnvelope(URL_, {}, "x", {
      maxRetries: 1,
      baseBackoffMs: 999,
      sleep: fastSleep,
    });
    expect(sleepCalls[0]).toBe(2000);
  });

  it("falls back to exponential backoff when Retry-After is absent", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(null, { status: 429 }))
      .mockResolvedValueOnce(new Response(null, { status: 202 }));
    await sendEnvelope(URL_, {}, "x", {
      maxRetries: 1,
      baseBackoffMs: 50,
      sleep: fastSleep,
      random: () => 1,
    });
    expect(sleepCalls[0]).toBe(50);
  });
});

describe("sendEnvelope — non-retryable", () => {
  it("does not retry on 4xx (other than 429)", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 400 }));
    await sendEnvelope(URL_, {}, "x", { sleep: fastSleep });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sleepCalls.length).toBe(0);
  });

  it("retries on network failure then resolves", async () => {
    fetchMock
      .mockRejectedValueOnce(new TypeError("network down"))
      .mockResolvedValueOnce(new Response(null, { status: 202 }));
    await sendEnvelope(URL_, {}, "x", {
      maxRetries: 1,
      baseBackoffMs: 1,
      sleep: fastSleep,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("never throws to the caller, even on persistent network failure", async () => {
    fetchMock.mockRejectedValue(new TypeError("nope"));
    await expect(
      sendEnvelope(URL_, {}, "x", {
        maxRetries: 1,
        baseBackoffMs: 1,
        sleep: fastSleep,
      }),
    ).resolves.toBeUndefined();
  });
});

describe("sendEnvelope — drop visibility (painkiller contract)", () => {
  it("warns once when retries are exhausted on persistent 500", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    fetchMock.mockResolvedValue(new Response(null, { status: 500 }));

    await sendEnvelope(URL_, {}, "x", {
      maxRetries: 1,
      baseBackoffMs: 1,
      sleep: fastSleep,
    });
    await sendEnvelope(URL_, {}, "y", {
      maxRetries: 1,
      baseBackoffMs: 1,
      sleep: fastSleep,
    });

    const dropWarnings = warnSpy.mock.calls.filter((call) =>
      String(call[0]).includes("Event dropped"),
    );
    expect(dropWarnings.length).toBe(1);
    expect(String(dropWarnings[0]?.[0])).toContain("500");

    warnSpy.mockRestore();
  });

  it("warns once when retries are exhausted on persistent network failure", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    fetchMock.mockRejectedValue(new TypeError("nope"));

    await sendEnvelope(URL_, {}, "x", {
      maxRetries: 1,
      baseBackoffMs: 1,
      sleep: fastSleep,
    });
    await sendEnvelope(URL_, {}, "y", {
      maxRetries: 1,
      baseBackoffMs: 1,
      sleep: fastSleep,
    });

    const dropWarnings = warnSpy.mock.calls.filter((call) =>
      String(call[0]).includes("Event dropped"),
    );
    expect(dropWarnings.length).toBe(1);
    expect(String(dropWarnings[0]?.[0])).toContain("network");

    warnSpy.mockRestore();
  });

  it("does not warn on transient failures that eventually succeed", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    fetchMock
      .mockResolvedValueOnce(new Response(null, { status: 500 }))
      .mockResolvedValueOnce(new Response(null, { status: 202 }));

    await sendEnvelope(URL_, {}, "x", {
      maxRetries: 2,
      baseBackoffMs: 1,
      sleep: fastSleep,
    });

    const dropWarnings = warnSpy.mock.calls.filter((call) =>
      String(call[0]).includes("Event dropped"),
    );
    expect(dropWarnings.length).toBe(0);

    warnSpy.mockRestore();
  });
});

describe("sendEnvelope — server-side warning headers", () => {
  it("warns once when X-Volato-Usage-Warn is present, then suppresses", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    fetchMock.mockResolvedValue(
      new Response(null, {
        status: 202,
        headers: { "X-Volato-Usage-Warn": "1" },
      }),
    );
    await sendEnvelope(URL_, {}, "x", { sleep: fastSleep });
    await sendEnvelope(URL_, {}, "x", { sleep: fastSleep });
    const usageWarns = warnSpy.mock.calls.filter((c) =>
      String(c[0]).includes("quota soft-warn"),
    );
    expect(usageWarns.length).toBe(1);
    warnSpy.mockRestore();
  });
});
