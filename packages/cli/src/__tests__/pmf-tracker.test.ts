import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPmfTracker } from "../../skills/detect-pmf/assets/pmf-tracker";

const DSN =
  "https://public-key@ingest.example.test/11111111-1111-4111-8111-111111111111";
const INGEST_TOKEN = "server-only-ingest-token";
const errorEvents = [
  {
    name: "error_resolved",
    description: "A developer resolves a production error.",
    properties: {},
    dedupe: "key",
  },
] as const;
const emptyEvents = [
  {
    name: "account_registered",
    description: "An eligible account enters the cohort.",
    properties: {},
    dedupe: "actor",
  },
] as const;

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_VOLATO_DSN", DSN);
  vi.stubEnv("VOLATO_INGEST_TOKEN", INGEST_TOKEN);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("detect-pmf tracker asset", () => {
  it("uses the existing server token and public DSN together", async () => {
    vi.stubEnv("NEXT_PUBLIC_VOLATO_DSN", DSN);
    vi.stubEnv("VOLATO_INGEST_TOKEN", INGEST_TOKEN);
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(null, { status: 202 }),
    );
    const tracker = createPmfTracker({
      events: emptyEvents,
      fetch: fetchMock,
    });

    const accepted = await tracker.track("account_registered", {
      actorId: "user_42",
      occurredAt: "2026-07-29T16:00:00.000Z",
    });

    expect(accepted).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://ingest.example.test/api/skill-events");
    expect(init?.headers).toEqual({
      "Content-Type": "application/json",
      "X-Volato-DSN": DSN,
      Authorization: `Bearer ${INGEST_TOKEN}`,
    });
    expect(JSON.parse(String(init?.body))).toEqual({
      schemaVersion: 1,
      skill: "detect-pmf",
      event: "account_registered",
      actorId: "user_42",
      occurredAt: "2026-07-29T16:00:00.000Z",
      properties: {},
    });
  });

  it("never sends with the public DSN alone", async () => {
    vi.stubEnv("VOLATO_INGEST_TOKEN", "");
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(null, { status: 202 }),
    );
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    const tracker = createPmfTracker({
      events: emptyEvents,
      fetch: fetchMock,
    });

    expect(
      await tracker.track("account_registered", { actorId: "user_42" }),
    ).toBe(false);
    expect(
      await tracker.track("account_registered", { actorId: "user_42" }),
    ).toBe(false);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(warning).toHaveBeenCalledTimes(1);
    expect(warning).toHaveBeenCalledWith(
      expect.stringContaining("VOLATO_INGEST_TOKEN"),
    );
  });

  it("refuses malformed server tokens before network I/O", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(null, { status: 202 }),
    );
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubEnv("VOLATO_INGEST_TOKEN", " \n");
    const tracker = createPmfTracker({
      events: emptyEvents,
      fetch: fetchMock,
    });

    expect(
      await tracker.track("account_registered", { actorId: "user_42" }),
    ).toBe(false);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(warning).toHaveBeenCalledWith(
      expect.stringContaining("VOLATO_INGEST_TOKEN"),
    );
  });

  it("reports malformed configuration once from track instead of throwing", async () => {
    vi.stubEnv("NEXT_PUBLIC_VOLATO_DSN", "not-a-dsn");
    const fetchMock = vi.fn<typeof fetch>();
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    const tracker = createPmfTracker({
      events: emptyEvents,
      fetch: fetchMock,
    });

    expect(
      await tracker.track("account_registered", { actorId: "user_42" }),
    ).toBe(false);
    await expect(
      tracker.track("account_registered", { actorId: "user_42" }),
    ).resolves.toBe(false);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(warning).toHaveBeenCalledTimes(1);
    expect(warning).toHaveBeenCalledWith(
      expect.stringContaining("NEXT_PUBLIC_VOLATO_DSN"),
    );
  });

  it("refuses to run in a browser runtime", async () => {
    vi.stubGlobal("window", {});
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(null, { status: 202 }),
    );
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    const tracker = createPmfTracker({
      events: emptyEvents,
      fetch: fetchMock,
    });

    expect(
      await tracker.track("account_registered", { actorId: "user_42" }),
    ).toBe(false);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(warning).toHaveBeenCalledWith(
      expect.stringContaining("server-only"),
    );
  });

  it("reports an undeclared event once without rejecting", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    const tracker = createPmfTracker({
      events: errorEvents,
      fetch: fetchMock,
    });
    const input = {
      actorId: "user_42",
      dedupeKey: "click_1",
    } as const;

    expect(
      await tracker.track("feature_clicked" as "error_resolved", input),
    ).toBe(false);
    await expect(
      tracker.track("feature_clicked" as "error_resolved", {
        ...input,
      }),
    ).resolves.toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(warning).toHaveBeenCalledTimes(1);
    expect(warning).toHaveBeenCalledWith(
      expect.stringContaining("is not declared"),
    );
  });

  it("reports invalid input once without rejecting", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    const tracker = createPmfTracker({
      events: errorEvents,
      fetch: fetchMock,
    });
    const input = {
      actorId: "",
      dedupeKey: "error_group_7",
    } as const;

    expect(await tracker.track("error_resolved", input)).toBe(false);
    await expect(
      tracker.track("error_resolved", input),
    ).resolves.toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(warning).toHaveBeenCalledTimes(1);
    expect(warning).toHaveBeenCalledWith(
      expect.stringContaining("actorId must be 1-128 characters"),
    );
  });

  it.each([
    "person@example.com",
    "-leading-hyphen",
    "actor with spaces",
  ])("rejects non-opaque actorId %s before network I/O", async (actorId) => {
    const fetchMock = vi.fn<typeof fetch>();
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    const tracker = createPmfTracker({
      events: emptyEvents,
      fetch: fetchMock,
    });

    expect(
      await tracker.track("account_registered", { actorId }),
    ).toBe(false);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(warning).toHaveBeenCalledWith(
      expect.stringContaining("actorId must start with an alphanumeric"),
    );
  });

  it("refuses catalogs with properties in the property-free PMF contract", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(null, { status: 202 }),
    );
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    const tracker = createPmfTracker({
      events: [
        {
          name: "account_registered",
          description: "An eligible account enters the cohort.",
          properties: { source: "string" },
          dedupe: "actor",
        },
      ] as unknown as typeof emptyEvents,
      fetch: fetchMock,
    });

    expect(
      await tracker.track("account_registered", {
        actorId: "user_42",
      }),
    ).toBe(false);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(warning).toHaveBeenCalledWith(
      expect.stringContaining("does not support properties"),
    );
  });

  it("reports an invalid event catalog from track instead of throwing", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    const tracker = createPmfTracker({
      events: [emptyEvents[0], emptyEvents[0]],
      fetch: fetchMock,
    });

    expect(
      await tracker.track("account_registered", { actorId: "user_42" }),
    ).toBe(false);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(warning).toHaveBeenCalledWith(
      expect.stringContaining("duplicated"),
    );
  });

  it("turns a missing catalog response into one actionable warning", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async () =>
      new Response(JSON.stringify({ error: "skill_not_configured" }), {
        status: 409,
        headers: { "content-type": "application/json" },
      }),
    );
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    const tracker = createPmfTracker({
      events: errorEvents,
      fetch: fetchMock,
    });
    const input = {
      actorId: "user_42",
      dedupeKey: "error_group_7",
    } as const;

    expect(await tracker.track("error_resolved", input)).toBe(false);
    expect(await tracker.track("error_resolved", input)).toBe(false);

    expect(warning).toHaveBeenCalledTimes(1);
    expect(warning).toHaveBeenCalledWith(
      expect.stringContaining("skill_not_configured"),
    );
    expect(warning).toHaveBeenCalledWith(
      expect.stringContaining("volato pmf sync"),
    );
  });

  it("reports a network failure once without failing the transition", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new Error("socket closed"));
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    const tracker = createPmfTracker({
      events: errorEvents,
      fetch: fetchMock,
    });
    const input = {
      actorId: "user_42",
      dedupeKey: "error_group_7",
    } as const;

    expect(await tracker.track("error_resolved", input)).toBe(false);
    expect(await tracker.track("error_resolved", input)).toBe(false);

    expect(warning).toHaveBeenCalledTimes(1);
    expect(warning).toHaveBeenCalledWith(
      expect.stringContaining("ingest endpoint is reachable"),
    );
  });

  it("bounds delivery with a short AbortSignal timeout", async () => {
    const signal = new AbortController().signal;
    const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(signal);
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(null, { status: 202 }),
    );
    const tracker = createPmfTracker({
      events: emptyEvents,
      fetch: fetchMock,
    });

    expect(
      await tracker.track("account_registered", { actorId: "user_42" }),
    ).toBe(true);

    expect(timeout).toHaveBeenCalledWith(2_000);
    expect(fetchMock.mock.calls[0]?.[1]?.signal).toBe(signal);
  });

  it("uses a safe ingest reason header when no JSON body exists", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(null, {
        status: 422,
        headers: { "X-Volato-Reason": "event_not_declared" },
      }),
    );
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    const tracker = createPmfTracker({
      events: errorEvents,
      fetch: fetchMock,
    });

    expect(
      await tracker.track("error_resolved", {
        actorId: "user_42",
        dedupeKey: "error_group_7",
      }),
    ).toBe(false);

    expect(warning).toHaveBeenCalledWith(
      expect.stringContaining("event_not_declared"),
    );
    expect(warning).toHaveBeenCalledWith(
      expect.stringContaining(".volato/pmf.json"),
    );
  });
});
