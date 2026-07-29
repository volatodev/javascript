import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { CliError } from "../lib/api-client.js";

export const PMF_SCHEMA_VERSION = 1 as const;
export const PMF_SKILL = "detect-pmf" as const;
export const DEFAULT_PMF_FILE = ".volato/pmf.json";

const KEY_PATTERN = /^[a-z][a-z0-9_-]{0,63}$/;
const PROPERTY_KEY_PATTERN = /^[a-z][a-z0-9_]{0,47}$/;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_CONFIG_BYTES = 32 * 1024;
const MAX_EVENTS = 32;
const MAX_PROPERTIES = 12;
const MAX_RETENTION_DAYS = 90;
const MIN_REPEAT_HOURS = 24;
const MAX_REPEAT_HOURS = MAX_RETENTION_DAYS * 24;

export type PmfPropertyType = "string" | "number" | "boolean";
export type PmfDedupe = "actor" | "key" | "none";

export type PmfEventDefinition = {
  name: string;
  description: string;
  properties: Record<string, PmfPropertyType>;
  dedupe: PmfDedupe;
};

export type PmfConfig = {
  schemaVersion: 1;
  projectId: string;
  skill: "detect-pmf";
  job: {
    statement: string;
    outcome: string;
  };
  events: PmfEventDefinition[];
  cohort: {
    event: string;
    windowDays: number;
  };
  activation: {
    event: string;
  };
  repeat: {
    event: string;
    minHours: number;
  };
  retention: {
    event: string;
    minDays: number;
    maxDays: number;
  };
};

function invalid(message: string): never {
  throw new CliError(`Invalid PMF config:\n- ${message}`);
}

function objectAt(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    invalid(`${path} must be an object`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  path: string,
): void {
  const allowedSet = new Set(allowed);
  const unknown = Object.keys(value).find((key) => !allowedSet.has(key));
  if (unknown) invalid(`${path} has unsupported field ${unknown}`);
}

function boundedString(
  value: unknown,
  path: string,
  maxLength: number,
): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maxLength
  ) {
    invalid(`${path} must be a string of 1-${maxLength} characters`);
  }
  return value;
}

function boundedInteger(
  value: unknown,
  path: string,
  min: number,
  max: number,
): number {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < min ||
    value > max
  ) {
    invalid(`${path} must be an integer between ${min} and ${max}`);
  }
  return value;
}

function eventReference(
  value: unknown,
  path: string,
  eventNames: ReadonlySet<string>,
): string {
  const event = boundedString(value, `${path}.event`, 64);
  if (!eventNames.has(event)) {
    invalid(`${path}.event must reference an event in the catalog`);
  }
  return event;
}

export function validatePmfConfig(value: unknown): PmfConfig {
  let encoded: string | undefined;
  try {
    encoded = JSON.stringify(value);
  } catch {
    invalid("config must be JSON serializable");
  }
  if (encoded === undefined) invalid("config must be JSON serializable");
  if (encoded.length > MAX_CONFIG_BYTES) {
    invalid(`config exceeds ${MAX_CONFIG_BYTES} bytes`);
  }

  const root = objectAt(value, "config");
  exactKeys(
    root,
    [
      "schemaVersion",
      "projectId",
      "skill",
      "job",
      "events",
      "cohort",
      "activation",
      "repeat",
      "retention",
    ],
    "config",
  );
  if (root.schemaVersion !== PMF_SCHEMA_VERSION) {
    invalid(`config.schemaVersion must be ${PMF_SCHEMA_VERSION}`);
  }

  const projectId = boundedString(root.projectId, "config.projectId", 36);
  if (!UUID_PATTERN.test(projectId)) {
    invalid("config.projectId must be a UUID");
  }
  const skill = boundedString(root.skill, "config.skill", 64);
  if (!KEY_PATTERN.test(skill) || skill !== PMF_SKILL) {
    invalid(`config.skill must be ${JSON.stringify(PMF_SKILL)}`);
  }

  const job = objectAt(root.job, "config.job");
  exactKeys(job, ["statement", "outcome"], "config.job");
  const statement = boundedString(
    job.statement,
    "config.job.statement",
    256,
  );
  const outcome = boundedString(job.outcome, "config.job.outcome", 256);

  if (!Array.isArray(root.events) || root.events.length === 0) {
    invalid("config.events must contain at least one event");
  }
  if (root.events.length > MAX_EVENTS) {
    invalid(`config.events cannot contain more than ${MAX_EVENTS} events`);
  }

  const eventNames = new Set<string>();
  const events = root.events.map((rawEvent, index): PmfEventDefinition => {
    const path = `config.events[${index}]`;
    const event = objectAt(rawEvent, path);
    exactKeys(
      event,
      ["name", "description", "properties", "dedupe"],
      path,
    );
    const name = boundedString(event.name, `${path}.name`, 64);
    if (!KEY_PATTERN.test(name)) {
      invalid(`${path}.name has an invalid format`);
    }
    if (eventNames.has(name)) {
      invalid(`${path}.name must be unique`);
    }
    eventNames.add(name);

    const description = boundedString(
      event.description,
      `${path}.description`,
      256,
    );
    const rawProperties = objectAt(event.properties, `${path}.properties`);
    const propertyEntries = Object.entries(rawProperties);
    if (propertyEntries.length > MAX_PROPERTIES) {
      invalid(
        `${path}.properties cannot contain more than ${MAX_PROPERTIES} keys`,
      );
    }
    const properties: Record<string, PmfPropertyType> = {};
    for (const [key, rawType] of propertyEntries) {
      if (!PROPERTY_KEY_PATTERN.test(key)) {
        invalid(`${path}.properties.${key} has an invalid key`);
      }
      if (
        rawType !== "string" &&
        rawType !== "number" &&
        rawType !== "boolean"
      ) {
        invalid(
          `${path}.properties.${key} must be string, number or boolean`,
        );
      }
      properties[key] = rawType;
    }

    if (
      event.dedupe !== "actor" &&
      event.dedupe !== "key" &&
      event.dedupe !== "none"
    ) {
      invalid(`${path}.dedupe must be actor, key or none`);
    }

    return {
      name,
      description,
      properties,
      dedupe: event.dedupe,
    };
  });

  const cohort = objectAt(root.cohort, "config.cohort");
  exactKeys(cohort, ["event", "windowDays"], "config.cohort");
  const cohortEvent = eventReference(cohort.event, "cohort", eventNames);
  const windowDays = boundedInteger(
    cohort.windowDays,
    "config.cohort.windowDays",
    1,
    MAX_RETENTION_DAYS,
  );

  const activation = objectAt(root.activation, "config.activation");
  exactKeys(activation, ["event"], "config.activation");
  const activationEvent = eventReference(
    activation.event,
    "activation",
    eventNames,
  );

  const repeat = objectAt(root.repeat, "config.repeat");
  exactKeys(repeat, ["event", "minHours"], "config.repeat");
  const repeatEvent = eventReference(repeat.event, "repeat", eventNames);
  const minHours = boundedInteger(
    repeat.minHours,
    "config.repeat.minHours",
    MIN_REPEAT_HOURS,
    MAX_REPEAT_HOURS,
  );

  const retention = objectAt(root.retention, "config.retention");
  exactKeys(
    retention,
    ["event", "minDays", "maxDays"],
    "config.retention",
  );
  const retentionEvent = eventReference(
    retention.event,
    "retention",
    eventNames,
  );
  const minDays = boundedInteger(
    retention.minDays,
    "config.retention.minDays",
    1,
    MAX_RETENTION_DAYS,
  );
  const maxDays = boundedInteger(
    retention.maxDays,
    "config.retention.maxDays",
    1,
    MAX_RETENTION_DAYS,
  );
  if (maxDays <= minDays) {
    invalid("config.retention.maxDays must be greater than minDays");
  }
  if (windowDays < maxDays) {
    invalid("config.cohort.windowDays must be >= retention.maxDays");
  }

  return {
    schemaVersion: PMF_SCHEMA_VERSION,
    projectId,
    skill: PMF_SKILL,
    job: { statement, outcome },
    events,
    cohort: { event: cohortEvent, windowDays },
    activation: { event: activationEvent },
    repeat: { event: repeatEvent, minHours },
    retention: { event: retentionEvent, minDays, maxDays },
  };
}

export function readPmfConfig(
  cwd: string,
  file = DEFAULT_PMF_FILE,
): { config: PmfConfig; path: string } {
  const path = resolve(cwd, file);
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new CliError(`Could not read PMF config ${path}: ${detail}`);
  }
  return { config: validatePmfConfig(parsed), path };
}

export function validateProjectId(value: string): string {
  if (!UUID_PATTERN.test(value)) {
    throw new CliError("A valid project id is required.");
  }
  return value;
}
