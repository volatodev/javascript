import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  runUsageSnapshotSave,
  runUsageReport,
  runUsageSync,
  runUsageValidate,
} from "../commands/analytics";
import { runReadme } from "../commands/readme";
import { linkProject } from "../integrations/manifest";
import {
  validateUsageSnapshot,
  validateUsageConfig,
} from "../commands/analytics-contract";

const projectId = "11111111-1111-4111-8111-111111111111";
const config = {
  schemaVersion: 1,
  projectId,
  product: {
    summary: "Volato gives coding agents production context.",
    targetActor: "Developers fixing production software with a coding agent.",
  },
  job: {
    statement: "Help a developer close a production error without leaving the editor.",
    outcome: "The developer resolves a real production error.",
  },
  events: [
    {
      name: "account_registered",
      description: "An eligible account joins the product.",
      properties: {},
      dedupe: "actor",
    },
    {
      name: "integration_connected",
      description: "The production application can send operational signals.",
      properties: {},
      dedupe: "actor",
    },
    {
      name: "error_resolved",
      description: "A production error is resolved through the agent loop.",
      properties: {},
      dedupe: "key",
    },
  ],
  milestones: [
    {
      event: "account_registered",
      question: "Did an eligible developer sign up?",
    },
    {
      event: "integration_connected",
      question: "Can the product observe a production outcome?",
    },
    {
      event: "error_resolved",
      question: "Did the developer resolve a real production error?",
    },
  ],
} as const;
const skillEnum = {
  type: "enum",
  values: ["production-errors", "monitor-product-usage"],
} as const;
const enumConfig = {
  ...config,
  events: [
    config.events[0],
    {
      ...config.events[1],
      properties: { skill: skillEnum },
      dedupe: "key",
    },
    {
      ...config.events[2],
      properties: { skill: skillEnum },
    },
  ],
} as const;
const snapshot = {
  schemaVersion: 1,
  configVersion: 3,
  approved: true,
  summary: "Eligible developers are reaching the production-error outcome.",
  observations: ["Four eligible developers reached the outcome this month."],
  caveats: ["Only two of them came back a second time."],
  nextDecision: "Wait for more timelines, then read the same journey again.",
} as const;

let cwd: string;

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), "volato-analytics-"));
  mkdirSync(join(cwd, ".volato"));
  linkProject(cwd, { id: projectId, name: "Volato" });
  writeFileSync(
    join(cwd, ".volato", "analytics.json"),
    `${JSON.stringify(config, null, 2)}\n`,
  );
  writeFileSync(
    join(cwd, ".volato", "analytics-snapshot.json"),
    `${JSON.stringify(snapshot, null, 2)}\n`,
  );
  vi.stubEnv("VOLATO_API_URL", "https://api.test.local");
  vi.stubEnv("VOLATO_TOKEN", "workspace-token");
  vi.spyOn(process.stdout, "write").mockImplementation(() => true);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  rmSync(cwd, { recursive: true, force: true });
});

describe("volato analytics sync", () => {
  it("syncs the complete local contract to the project skill endpoint", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          markdown: "# Product usage catalog synced",
          data: { projectId, eventCount: 2 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    await runUsageSync({ cwd });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(
      `https://api.test.local/v1/projects/${projectId}/skills/monitor-product-usage/config`,
    );
    expect(JSON.parse(String(init?.body))).toEqual({
      schemaVersion: 1,
      config: { ...config, skill: "monitor-product-usage" },
    });
    expect((init?.headers as Record<string, string>).Authorization).toBe(
      "Bearer workspace-token",
    );
    expect(process.stdout.write).toHaveBeenCalledWith(
      "# Product usage catalog synced\n",
    );
  });
});

describe("volato analytics validate", () => {
  it("validates locally without making a network request", () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");

    runUsageValidate({ cwd, json: true });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(process.stdout.write).toHaveBeenCalledWith(
      expect.stringContaining('"valid":true'),
    );
  });

  it("rejects fields outside the versioned backend contract", () => {
    expect(() =>
      validateUsageConfig({
        ...config,
        tenantId: "free-form-tenant",
      }),
    ).toThrow("unsupported field tenantId");
  });

  it("rejects a legacy cohort declaration instead of silently ignoring it", () => {
    expect(() =>
      validateUsageConfig({
        ...config,
        cohort: { event: "account_registered", windowDays: 90 },
      }),
    ).toThrow("unsupported field cohort");
  });

  it("accepts strict enum properties on events", () => {
    expect(validateUsageConfig(enumConfig)).toEqual(enumConfig);
  });

  it("keeps property-free linear maps valid", () => {
    expect(validateUsageConfig(config)).toEqual(config);
  });

  it("accepts 40 declared events when the document remains below 32 KiB", () => {
    const value = {
      ...config,
      events: [
        ...config.events,
        ...Array.from({ length: 37 }, (_, index) => ({
          name: `supporting_event_${index}`,
          description: "A server-owned business outcome.",
          properties: {},
          dedupe: "actor",
        })),
      ],
    };

    expect(Buffer.byteLength(JSON.stringify(value), "utf8")).toBeLessThan(
      32 * 1024,
    );
    expect(validateUsageConfig(value).events).toHaveLength(40);
  });

  it("accepts a twelve-step journey now that the milestone cap is gone", () => {
    const steps = Array.from({ length: 12 }, (_, index) => ({
      name: `journey_step_${index}`,
      description: "A step the actor is expected to reach.",
      properties: {},
      dedupe: "actor" as const,
    }));
    const value = {
      ...config,
      events: steps,
      milestones: steps.map((step) => ({
        event: step.name,
        question: `Did the actor reach ${step.name}?`,
      })),
    };

    expect(validateUsageConfig(value).milestones).toHaveLength(12);
  });

  it("rejects free-form property definitions", () => {
    expect(() =>
      validateUsageConfig({
        ...config,
        events: [
          {
            ...config.events[0],
            properties: { source: "string" },
          },
        ],
      }),
    ).toThrow("properties.source must be an object");
  });

  it.each([
    {
      label: "an enum with unsupported definition fields",
      mutate: () => ({
        ...enumConfig,
        events: enumConfig.events.map((event) =>
          event.name === "integration_connected"
            ? {
                ...event,
                properties: {
                  skill: { ...skillEnum, fallback: "production-errors" },
                },
              }
            : event,
        ),
      }),
      message: "properties.skill has unsupported field fallback",
    },
    {
      label: "an empty enum",
      mutate: () => ({
        ...enumConfig,
        events: enumConfig.events.map((event) =>
          event.name === "integration_connected"
            ? {
                ...event,
                properties: {
                  skill: { type: "enum", values: [] },
                },
              }
            : event,
        ),
      }),
      message: "properties.skill.values must contain at least one enum value",
    },
    {
      label: "duplicate enum values",
      mutate: () => ({
        ...enumConfig,
        events: enumConfig.events.map((event) =>
          event.name === "integration_connected"
            ? {
                ...event,
                properties: {
                  skill: {
                    type: "enum",
                    values: ["monitor-product-usage", "monitor-product-usage"],
                  },
                },
              }
            : event,
        ),
      }),
      message: "properties.skill.values[1] must be unique",
    },
  ])("rejects $label", ({ mutate, message }) => {
    expect(() => validateUsageConfig(mutate())).toThrow(message);
  });

  it.each([
    {
      label: "fewer than two milestones",
      milestones: [config.milestones[0]],
      message: "config.milestones must contain at least 2 milestones",
    },
    {
      label: "duplicate milestone events",
      milestones: [config.milestones[0], config.milestones[0]],
      message: "config.milestones[1].event must be unique",
    },
    {
      label: "a milestone event outside the catalog",
      milestones: [
        config.milestones[0],
        {
          event: "unknown_event",
          question: "Did the unknown transition happen?",
        },
      ],
      message:
        "config.milestones[1].event must reference an event in the catalog",
    },
  ])("rejects $label", ({ milestones, message }) => {
    expect(() => validateUsageConfig({ ...config, milestones })).toThrow(
      message,
    );
  });

  it.each([
    {
      label: "future UUID versions",
      value: { ...config, projectId: "11111111-1111-8111-8111-111111111111" },
      message: "config.projectId must be a UUID",
    },
    {
      label: "documents larger than 32 KiB",
      value: {
        ...config,
        events: Array.from({ length: 32 }, (_, eventIndex) => ({
          name: `event_${eventIndex}`,
          description: "d".repeat(256),
          properties: Object.fromEntries(
            Array.from({ length: 12 }, (_, propertyIndex) => [
              `p${propertyIndex}_${"x".repeat(44)}`,
              "string",
            ]),
          ),
          dedupe: "actor",
        })),
      },
      message: "config exceeds 32768 bytes",
    },
  ])("rejects $label", ({ value, message }) => {
    expect(() => validateUsageConfig(value)).toThrow(message);
  });

  it("counts the 32 KiB config limit in UTF-8 bytes", () => {
    const value = {
      ...config,
      unicodePadding: "é".repeat(16_000),
    };
    const encoded = JSON.stringify(value);

    expect(encoded.length).toBeLessThan(32 * 1024);
    expect(new TextEncoder().encode(encoded).length).toBeGreaterThan(32 * 1024);
    expect(() => validateUsageConfig(value)).toThrow(
      "config exceeds 32768 bytes",
    );
  });
});

describe("volato analytics report", () => {
  it("reads the outcome report for the configured project", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          markdown: "# Product usage evidence",
          data: { activation: { actors: 4 } },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    await runUsageReport({ cwd, json: true });

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      `https://api.test.local/v1/projects/${projectId}/skills/monitor-product-usage/report`,
    );
    expect(process.stdout.write).toHaveBeenCalledWith(
      expect.stringContaining('"activation":{"actors":4}'),
    );
  });
});

describe("volato analytics snapshot save", () => {
  it("posts an explicitly approved snapshot to the project skill endpoint", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          markdown: "# Product usage snapshot saved",
          data: { projectId, configVersion: 3 },
        }),
        { status: 201, headers: { "content-type": "application/json" } },
      ),
    );

    await runUsageSnapshotSave({ cwd, json: true });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(
      `https://api.test.local/v1/projects/${projectId}/skills/monitor-product-usage/snapshots`,
    );
    expect(JSON.parse(String(init?.body))).toEqual(snapshot);
    expect(
      (init?.headers as Record<string, string>)["Idempotency-Key"],
    ).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(process.stdout.write).toHaveBeenCalledWith(
      expect.stringContaining('"configVersion":3'),
    );
  });

  it("reuses one snapshot idempotency key across automatic retries", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: "unavailable" }), {
          status: 503,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            markdown: "# Product usage snapshot saved",
            data: { projectId, configVersion: 3 },
          }),
          { status: 201, headers: { "content-type": "application/json" } },
        ),
      );

    await runUsageSnapshotSave({ cwd, json: true });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const keys = fetchMock.mock.calls.map(
      ([, init]) =>
        (init?.headers as Record<string, string>)["Idempotency-Key"],
    );
    expect(keys[0]).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(keys[1]).toBe(keys[0]);
  });

  it.each([
    {
      label: "automatic or unapproved snapshots",
      value: { ...snapshot, approved: false },
      message: "snapshot.approved must be true",
    },
    {
      label: "PMF score fields",
      value: { ...snapshot, status: "product_market_fit" },
      message: "snapshot has unsupported field status",
    },
    {
      label: "non-positive config versions",
      value: { ...snapshot, configVersion: 0 },
      message: "snapshot.configVersion must be a positive integer",
    },
    {
      label: "more than eight observations",
      value: {
        ...snapshot,
        observations: Array.from({ length: 9 }, () => "Observed outcome."),
      },
      message: "snapshot.observations cannot contain more than 8 items",
    },
    {
      label: "overlong caveats",
      value: { ...snapshot, caveats: ["x".repeat(257)] },
      message:
        "snapshot.caveats[0] must be a string of 1-256 characters",
    },
    {
      label: "unsupported fields",
      value: { ...snapshot, evidenceSource: "survey" },
      message: "snapshot has unsupported field evidenceSource",
    },
  ])("rejects $label", ({ value, message }) => {
    expect(() => validateUsageSnapshot(value)).toThrow(message);
  });
});

describe("volato product analytics discovery", () => {
  it("lists snapshot save in the agent-facing command reference", () => {
    runReadme();

    expect(process.stdout.write).toHaveBeenCalledWith(
      expect.stringContaining("volato analytics snapshot save"),
    );
  });
});
