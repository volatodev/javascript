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
  runPmfReport,
  runPmfSync,
  runPmfValidate,
} from "../commands/pmf";
import { validatePmfConfig } from "../commands/pmf-contract";

const projectId = "11111111-1111-4111-8111-111111111111";
const config = {
  schemaVersion: 1,
  projectId,
  skill: "detect-pmf",
  job: {
    statement: "Help a developer close a production error without leaving the editor.",
    outcome: "The developer resolves a real production error.",
  },
  events: [
    {
      name: "account_registered",
      description: "An eligible account enters the cohort.",
      properties: { source: "string" },
      dedupe: "actor",
    },
    {
      name: "error_resolved",
      description: "A production error is resolved through the agent loop.",
      properties: { plan: "string" },
      dedupe: "key",
    },
  ],
  cohort: { event: "account_registered", windowDays: 90 },
  activation: { event: "error_resolved" },
  repeat: { event: "error_resolved", minHours: 24 },
  retention: { event: "error_resolved", minDays: 7, maxDays: 35 },
} as const;

let cwd: string;

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), "volato-pmf-"));
  mkdirSync(join(cwd, ".volato"));
  writeFileSync(
    join(cwd, ".volato", "pmf.json"),
    `${JSON.stringify(config, null, 2)}\n`,
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

  it.each([
    {
      label: "future UUID versions",
      value: { ...config, projectId: "11111111-1111-8111-8111-111111111111" },
      message: "config.projectId must be a UUID",
    },
    {
      label: "more than 32 events",
      value: {
        ...config,
        events: Array.from({ length: 33 }, (_, index) => ({
          name: `event_${index}`,
          description: "A server-owned business outcome.",
          properties: {},
          dedupe: "actor",
        })),
      },
      message: "cannot contain more than 32 events",
    },
    {
      label: "more than 12 properties",
      value: {
        ...config,
        events: [
          {
            ...config.events[0],
            properties: Object.fromEntries(
              Array.from({ length: 13 }, (_, index) => [
                `property_${index}`,
                "string",
              ]),
            ),
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
      },
      message: "cannot contain more than 12 keys",
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
