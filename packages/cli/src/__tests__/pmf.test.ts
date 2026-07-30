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
  runPmfAssessmentSave,
  runPmfReport,
  runPmfSync,
  runPmfValidate,
} from "../commands/pmf";
import { runReadme } from "../commands/readme";
import {
  validatePmfAssessment,
  validatePmfConfig,
} from "../commands/pmf-contract";

const projectId = "11111111-1111-4111-8111-111111111111";
const config = {
  schemaVersion: 1,
  projectId,
  skill: "detect-pmf",
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
      description: "An eligible account enters the cohort.",
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
      question: "Did an eligible developer enter the cohort?",
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
  cohort: { event: "account_registered", windowDays: 90 },
  activation: { event: "error_resolved" },
  repeat: { event: "error_resolved", minHours: 24 },
  retention: { event: "error_resolved", minDays: 7, maxDays: 35 },
} as const;
const skillEnum = {
  type: "enum",
  values: ["production-errors", "detect-pmf"],
} as const;
const branchedConfig = {
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
  branches: { property: "skill" },
} as const;
const assessment = {
  schemaVersion: 1,
  configVersion: 3,
  approved: true,
  status: "promising_signal",
  summary: "Eligible developers are reaching the production-error outcome.",
  observations: ["Four eligible developers activated in the current cohort."],
  caveats: ["The repeat-use window is still immature."],
  nextDecision: "Wait for the repeat window, then review the same cohort.",
} as const;

let cwd: string;

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), "volato-pmf-"));
  mkdirSync(join(cwd, ".volato"));
  writeFileSync(
    join(cwd, ".volato", "pmf.json"),
    `${JSON.stringify(config, null, 2)}\n`,
  );
  writeFileSync(
    join(cwd, ".volato", "pmf-assessment.json"),
    `${JSON.stringify(assessment, null, 2)}\n`,
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

describe("volato pmf sync", () => {
  it("syncs the complete local contract to the project skill endpoint", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          markdown: "# PMF catalog synced",
          data: { projectId, eventCount: 2 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    await runPmfSync({ cwd });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(
      `https://api.test.local/v1/projects/${projectId}/skills/detect-pmf/config`,
    );
    expect(JSON.parse(String(init?.body))).toEqual({
      schemaVersion: 1,
      config,
    });
    expect((init?.headers as Record<string, string>).Authorization).toBe(
      "Bearer workspace-token",
    );
    expect(process.stdout.write).toHaveBeenCalledWith(
      "# PMF catalog synced\n",
    );
  });
});

describe("volato pmf validate", () => {
  it("validates locally without making a network request", () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");

    runPmfValidate({ cwd, json: true });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(process.stdout.write).toHaveBeenCalledWith(
      expect.stringContaining('"valid":true'),
    );
  });

  it("rejects repeat windows that cannot prove a later-day return", () => {
    expect(() =>
      validatePmfConfig({
        ...config,
        repeat: { ...config.repeat, minHours: 1 },
      }),
    ).toThrow("repeat.minHours must be an integer between 24 and 2160");
  });

  it("rejects the legacy schema version 1 shape without compatibility fallback", () => {
    expect(() =>
      validatePmfConfig({
        schemaVersion: 1,
        projectId,
        skill: "detect-pmf",
        events: config.events,
        cohort: config.cohort,
        activation: config.activation,
        repeat: config.repeat,
        retention: config.retention,
      }),
    ).toThrow("config.product must be an object");
  });

  it("rejects fields outside the versioned backend contract", () => {
    expect(() =>
      validatePmfConfig({
        ...config,
        tenantId: "free-form-tenant",
      }),
    ).toThrow("unsupported field tenantId");
  });

  it("rejects cohorts that end before the retention window matures", () => {
    expect(() =>
      validatePmfConfig({
        ...config,
        cohort: { ...config.cohort, windowDays: 30 },
      }),
    ).toThrow("cohort.windowDays must be >= retention.maxDays");
  });

  it("accepts strict enum properties and a comparable branch dimension", () => {
    expect(validatePmfConfig(branchedConfig)).toEqual(branchedConfig);
  });

  it("keeps property-free linear maps valid", () => {
    expect(validatePmfConfig(config)).toEqual(config);
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
    expect(validatePmfConfig(value).events).toHaveLength(40);
  });

  it("rejects free-form property definitions", () => {
    expect(() =>
      validatePmfConfig({
        ...config,
        events: [
          {
            ...config.events[0],
            properties: { source: "string" },
          },
        ],
        cohort: { event: "account_registered", windowDays: 90 },
        activation: { event: "account_registered" },
        repeat: { event: "account_registered", minHours: 24 },
        retention: {
          event: "account_registered",
          minDays: 7,
          maxDays: 35,
        },
      }),
    ).toThrow("properties.source must be an object");
  });

  it.each([
    {
      label: "an enum with unsupported definition fields",
      mutate: () => ({
        ...branchedConfig,
        events: branchedConfig.events.map((event) =>
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
        ...branchedConfig,
        events: branchedConfig.events.map((event) =>
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
        ...branchedConfig,
        events: branchedConfig.events.map((event) =>
          event.name === "integration_connected"
            ? {
                ...event,
                properties: {
                  skill: {
                    type: "enum",
                    values: ["detect-pmf", "detect-pmf"],
                  },
                },
              }
            : event,
        ),
      }),
      message: "properties.skill.values[1] must be unique",
    },
    {
      label: "a missing branch property",
      mutate: () => ({
        ...branchedConfig,
        events: branchedConfig.events.map((event) =>
          event.name === "integration_connected"
            ? { ...event, properties: {} }
            : event,
        ),
      }),
      message:
        "event integration_connected must declare enum property skill used by config.branches",
    },
    {
      label: "different branch enums",
      mutate: () => ({
        ...branchedConfig,
        events: branchedConfig.events.map((event) =>
          event.name === "error_resolved"
            ? {
                ...event,
                properties: {
                  skill: {
                    type: "enum",
                    values: ["detect-pmf", "production-errors"],
                  },
                },
              }
            : event,
        ),
      }),
      message:
        "event error_resolved must declare the same enum property skill used by config.branches",
    },
    {
      label: "actor dedupe on a branch stage",
      mutate: () => ({
        ...branchedConfig,
        events: branchedConfig.events.map((event) =>
          event.name === "integration_connected"
            ? { ...event, dedupe: "actor" }
            : event,
        ),
      }),
      message:
        "event integration_connected cannot use actor dedupe with branch property skill",
    },
  ])("rejects $label", ({ mutate, message }) => {
    expect(() => validatePmfConfig(mutate())).toThrow(message);
  });

  it.each([
    {
      label: "fewer than two milestones",
      milestones: [config.milestones[0]],
      message: "config.milestones must contain between 2 and 8 milestones",
    },
    {
      label: "duplicate milestone events",
      milestones: [config.milestones[0], config.milestones[0]],
      message: "config.milestones[1].event must be unique",
    },
    {
      label: "a first milestone outside the cohort",
      milestones: [config.milestones[1], config.milestones[2]],
      message: "config.milestones[0].event must match config.cohort.event",
    },
    {
      label: "a last milestone outside activation",
      milestones: [config.milestones[0], config.milestones[1]],
      message: "config.milestones[1].event must match config.activation.event",
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
    expect(() => validatePmfConfig({ ...config, milestones })).toThrow(
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
      label: "equal retention boundaries",
      value: {
        ...config,
        retention: { ...config.retention, minDays: 35 },
      },
      message: "maxDays must be greater than minDays",
    },
    {
      label: "repeat windows beyond stored history",
      value: {
        ...config,
        repeat: { ...config.repeat, minHours: 2161 },
      },
      message: "between 24 and 2160",
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
    expect(() => validatePmfConfig(value)).toThrow(message);
  });

  it("counts the 32 KiB config limit in UTF-8 bytes", () => {
    const value = {
      ...config,
      unicodePadding: "é".repeat(16_000),
    };
    const encoded = JSON.stringify(value);

    expect(encoded.length).toBeLessThan(32 * 1024);
    expect(new TextEncoder().encode(encoded).length).toBeGreaterThan(32 * 1024);
    expect(() => validatePmfConfig(value)).toThrow(
      "config exceeds 32768 bytes",
    );
  });
});

describe("volato pmf report", () => {
  it("reads the outcome report for the configured project", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          markdown: "# PMF evidence",
          data: { activation: { actors: 4 } },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    await runPmfReport({ cwd, json: true });

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      `https://api.test.local/v1/projects/${projectId}/skills/detect-pmf/report`,
    );
    expect(process.stdout.write).toHaveBeenCalledWith(
      expect.stringContaining('"activation":{"actors":4}'),
    );
  });
});

describe("volato pmf assessment save", () => {
  it("posts an explicitly approved assessment to the project skill endpoint", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          markdown: "# PMF assessment saved",
          data: { projectId, configVersion: 3 },
        }),
        { status: 201, headers: { "content-type": "application/json" } },
      ),
    );

    await runPmfAssessmentSave({ cwd, json: true });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(
      `https://api.test.local/v1/projects/${projectId}/skills/detect-pmf/assessments`,
    );
    expect(JSON.parse(String(init?.body))).toEqual(assessment);
    expect(
      (init?.headers as Record<string, string>)["Idempotency-Key"],
    ).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(process.stdout.write).toHaveBeenCalledWith(
      expect.stringContaining('"configVersion":3'),
    );
  });

  it("reuses one assessment idempotency key across automatic retries", async () => {
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
            markdown: "# PMF assessment saved",
            data: { projectId, configVersion: 3 },
          }),
          { status: 201, headers: { "content-type": "application/json" } },
        ),
      );

    await runPmfAssessmentSave({ cwd, json: true });

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
      label: "automatic or unapproved assessments",
      value: { ...assessment, approved: false },
      message: "assessment.approved must be true",
    },
    {
      label: "unknown signal statuses",
      value: { ...assessment, status: "product_market_fit" },
      message: "assessment.status must be",
    },
    {
      label: "non-positive config versions",
      value: { ...assessment, configVersion: 0 },
      message: "assessment.configVersion must be a positive integer",
    },
    {
      label: "more than eight observations",
      value: {
        ...assessment,
        observations: Array.from({ length: 9 }, () => "Observed outcome."),
      },
      message: "assessment.observations cannot contain more than 8 items",
    },
    {
      label: "overlong caveats",
      value: { ...assessment, caveats: ["x".repeat(257)] },
      message:
        "assessment.caveats[0] must be a string of 1-256 characters",
    },
    {
      label: "unsupported fields",
      value: { ...assessment, evidenceSource: "survey" },
      message: "assessment has unsupported field evidenceSource",
    },
  ])("rejects $label", ({ value, message }) => {
    expect(() => validatePmfAssessment(value)).toThrow(message);
  });
});

describe("volato PMF discovery", () => {
  it("lists assessment save in the agent-facing command reference", () => {
    runReadme();

    expect(process.stdout.write).toHaveBeenCalledWith(
      expect.stringContaining("volato pmf assessment save"),
    );
  });
});
