import { afterEach, describe, expect, it, vi } from "vitest";
import { createPmfTracker } from "../../skills/detect-pmf/assets/pmf-tracker";

const DSN =
  "https://public-key@ingest.example.test/11111111-1111-4111-8111-111111111111";
const events = [
  {
    name: "error_resolved",
    description: "A developer resolves a production error.",
    properties: { plan: "string", duration_minutes: "number" },
    dedupe: "key",
  },
] as const;

afterEach(() => {
  vi.restoreAllMocks();
});

describe("detect-pmf tracker asset", () => {
  it("posts a declared outcome with only the public DSN", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(null, { status: 202 }),
    );
    const tracker = createPmfTracker({ dsn: DSN, events, fetch: fetchMock });

    const accepted = await tracker.track("error_resolved", {
      actorId: "user_42",
      occurredAt: "2026-07-29T16:00:00.000Z",
      dedupeKey: "error_group_7",
      properties: { plan: "pro", duration_minutes: 12 },
    });

    expect(accepted).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://ingest.example.test/api/skill-events");
    expect(init?.headers).toEqual({
      "Content-Type": "application/json",
      "X-Volato-DSN": DSN,
    });
    expect(JSON.parse(String(init?.body))).toEqual({
      schemaVersion: 1,
      skill: "detect-pmf",
      event: "error_resolved",
      actorId: "user_42",
      occurredAt: "2026-07-29T16:00:00.000Z",
      dedupeKey: "error_group_7",
      properties: { plan: "pro", duration_minutes: 12 },
    });
  });

  it("rejects undeclared events before network I/O", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    const tracker = createPmfTracker({ dsn: DSN, events, fetch: fetchMock });

    await expect(
      tracker.track("feature_clicked" as "error_resolved", {
        actorId: "user_42",
        dedupeKey: "click_1",
        properties: { plan: "pro", duration_minutes: 1 },
      }),
    ).rejects.toThrow("is not declared");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects property values that violate the catalog", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    const tracker = createPmfTracker({ dsn: DSN, events, fetch: fetchMock });

    await expect(
      tracker.track("error_resolved", {
        actorId: "user_42",
        dedupeKey: "error_group_7",
        properties: {
          plan: "",
          duration_minutes: Number.POSITIVE_INFINITY,
        },
      }),
    ).rejects.toThrow("properties.plan must be 1-256 characters");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("turns a missing catalog response into one actionable warning", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async () =>
      new Response(JSON.stringify({ error: "skill_not_configured" }), {
        status: 409,
        headers: { "content-type": "application/json" },
      }),
    );
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    const tracker = createPmfTracker({ dsn: DSN, events, fetch: fetchMock });
    const input = {
      actorId: "user_42",
      dedupeKey: "error_group_7",
      properties: { plan: "pro", duration_minutes: 12 },
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
    const tracker = createPmfTracker({ dsn: DSN, events, fetch: fetchMock });
    const input = {
      actorId: "user_42",
      dedupeKey: "error_group_7",
      properties: { plan: "pro", duration_minutes: 12 },
    } as const;

    expect(await tracker.track("error_resolved", input)).toBe(false);
    expect(await tracker.track("error_resolved", input)).toBe(false);

    expect(warning).toHaveBeenCalledTimes(1);
    expect(warning).toHaveBeenCalledWith(
      expect.stringContaining("ingest endpoint is reachable"),
    );
  });

  it("uses a safe ingest reason header when no JSON body exists", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(null, {
        status: 422,
        headers: { "X-Volato-Reason": "event_not_declared" },
      }),
    );
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    const tracker = createPmfTracker({ dsn: DSN, events, fetch: fetchMock });

    expect(
      await tracker.track("error_resolved", {
        actorId: "user_42",
        dedupeKey: "error_group_7",
        properties: { plan: "pro", duration_minutes: 12 },
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
