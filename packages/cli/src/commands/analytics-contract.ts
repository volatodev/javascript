import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { CliError } from "../lib/api-client.js";

export const USAGE_SCHEMA_VERSION = 1 as const;
export const ANALYTICS_BACKEND_SKILL = "monitor-product-usage" as const;
export const DEFAULT_USAGE_FILE = ".volato/analytics.json";
export const DEFAULT_USAGE_SNAPSHOT_FILE =
  ".volato/analytics-snapshot.json";
export const USAGE_SNAPSHOT_SCHEMA_VERSION = 1 as const;

const KEY_PATTERN = /^[a-z][a-z0-9_-]{0,63}$/;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_CONFIG_BYTES = 32 * 1024;
// A journey needs at least two steps to describe progress. There is no upper
// bound: the document size is the honest limit, and a founder who needs nine
// steps should not be told that eight is a law.
const MIN_MILESTONES = 2;

export type UsageDedupe = "actor" | "key" | "none";

export type UsageEnumDefinition = {
  type: "enum";
  values: string[];
};

export type UsageEventDefinition = {
  name: string;
  description: string;
  properties: Record<string, UsageEnumDefinition>;
  dedupe: UsageDedupe;
};

/**
 * An approved product usage contract.
 *
 * The contract declares what is captured and in which order it is expected to
 * happen — nothing else. Conversion rates, time to value and repeat are read
 * from each actor's timeline at report time rather than declared up front:
 * a founder cannot know the right cohort window before seeing any data, and a
 * ratio over three actors says less than the three timelines themselves.
 */
export type UsageConfig = {
  schemaVersion: 1;
  projectId: string;
  product: {
    summary: string;
    targetActor: string;
  };
  job: {
    statement: string;
    outcome: string;
  };
  events: UsageEventDefinition[];
  /**
   * The expected order of the journey, from first contact to delivered value.
   * Ordering is what lets a report say "stalled at step 4" instead of listing
   * unrelated facts. Only a minimum is enforced: the 32 KiB document bound is
   * the real limit, an arbitrary step count is not.
   */
  milestones: Array<{
    event: string;
    question: string;
  }>;
};

export type UsageSnapshot = {
  schemaVersion: 1;
  configVersion: number;
  approved: true;
  summary: string;
  observations: string[];
  caveats: string[];
  nextDecision: string;
};

function invalid(message: string): never {
  throw new CliError(`Invalid product usage config:\n- ${message}`);
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

export function validateUsageConfig(value: unknown): UsageConfig {
  let encoded: string | undefined;
  try {
    encoded = JSON.stringify(value);
  } catch {
    invalid("config must be JSON serializable");
  }
  if (encoded === undefined) invalid("config must be JSON serializable");
  if (Buffer.byteLength(encoded, "utf8") > MAX_CONFIG_BYTES) {
    invalid(`config exceeds ${MAX_CONFIG_BYTES} bytes`);
  }

  const root = objectAt(value, "config");
  exactKeys(
    root,
    [
      "schemaVersion",
      "projectId",
      "product",
      "job",
      "events",
      "milestones",
    ],
    "config",
  );
  if (root.schemaVersion !== USAGE_SCHEMA_VERSION) {
    invalid(`config.schemaVersion must be ${USAGE_SCHEMA_VERSION}`);
  }

  const projectId = boundedString(root.projectId, "config.projectId", 36);
  if (!UUID_PATTERN.test(projectId)) {
    invalid("config.projectId must be a UUID");
  }
  const product = objectAt(root.product, "config.product");
  exactKeys(product, ["summary", "targetActor"], "config.product");
  const productSummary = boundedString(
    product.summary,
    "config.product.summary",
    512,
  );
  const targetActor = boundedString(
    product.targetActor,
    "config.product.targetActor",
    256,
  );

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

  const eventNames = new Set<string>();
  const eventsByName = new Map<string, UsageEventDefinition>();
  const events = root.events.map((rawEvent, index): UsageEventDefinition => {
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
    const properties: Record<string, UsageEnumDefinition> = {};
    for (const [propertyKey, rawDefinition] of Object.entries(rawProperties)) {
      const propertyPath = `${path}.properties.${propertyKey}`;
      if (!KEY_PATTERN.test(propertyKey)) {
        invalid(`${propertyPath} has an invalid property name`);
      }
      const definition = objectAt(rawDefinition, propertyPath);
      exactKeys(definition, ["type", "values"], propertyPath);
      if (definition.type !== "enum") {
        invalid(`${propertyPath}.type must be enum`);
      }
      if (!Array.isArray(definition.values) || definition.values.length === 0) {
        invalid(`${propertyPath}.values must contain at least one enum value`);
      }
      const seenValues = new Set<string>();
      const values = Array.from(definition.values).map(
        (rawValue, valueIndex) => {
          const enumValue = boundedString(
            rawValue,
            `${propertyPath}.values[${valueIndex}]`,
            64,
          );
          if (!KEY_PATTERN.test(enumValue)) {
            invalid(
              `${propertyPath}.values[${valueIndex}] has an invalid format`,
            );
          }
          if (seenValues.has(enumValue)) {
            invalid(
              `${propertyPath}.values[${valueIndex}] must be unique`,
            );
          }
          seenValues.add(enumValue);
          return enumValue;
        },
      );
      properties[propertyKey] = { type: "enum", values };
    }

    if (
      event.dedupe !== "actor" &&
      event.dedupe !== "key" &&
      event.dedupe !== "none"
    ) {
      invalid(`${path}.dedupe must be actor, key or none`);
    }

    const parsed: UsageEventDefinition = {
      name,
      description,
      properties,
      dedupe: event.dedupe,
    };
    eventsByName.set(name, parsed);
    return parsed;
  });

  if (
    !Array.isArray(root.milestones) ||
    root.milestones.length < MIN_MILESTONES
  ) {
    invalid(
      `config.milestones must contain at least ${MIN_MILESTONES} milestones`,
    );
  }
  const milestoneEvents = new Set<string>();
  const milestones = root.milestones.map((rawMilestone, index) => {
    const path = `config.milestones[${index}]`;
    const milestone = objectAt(rawMilestone, path);
    exactKeys(milestone, ["event", "question"], path);
    const event = eventReference(milestone.event, path, eventNames);
    if (milestoneEvents.has(event)) {
      invalid(`${path}.event must be unique`);
    }
    milestoneEvents.add(event);
    return {
      event,
      question: boundedString(
        milestone.question,
        `${path}.question`,
        256,
      ),
    };
  });
  return {
    schemaVersion: USAGE_SCHEMA_VERSION,
    projectId,
    product: { summary: productSummary, targetActor },
    job: { statement, outcome },
    events,
    milestones,
  };
}

function invalidSnapshot(message: string): never {
  throw new CliError(`Invalid product usage snapshot:\n- ${message}`);
}

function snapshotObject(
  value: unknown,
  path: string,
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    invalidSnapshot(`${path} must be an object`);
  }
  return value as Record<string, unknown>;
}

function snapshotExactKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  path: string,
): void {
  const allowedSet = new Set(allowed);
  const unknown = Object.keys(value).find((key) => !allowedSet.has(key));
  if (unknown) invalidSnapshot(`${path} has unsupported field ${unknown}`);
}

function snapshotString(
  value: unknown,
  path: string,
  maxLength: number,
): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maxLength
  ) {
    invalidSnapshot(
      `${path} must be a string of 1-${maxLength} characters`,
    );
  }
  return value;
}

function snapshotStringList(
  value: unknown,
  path: string,
): string[] {
  if (!Array.isArray(value)) {
    invalidSnapshot(`${path} must be an array`);
  }
  if (value.length > 8) {
    invalidSnapshot(`${path} cannot contain more than 8 items`);
  }
  return value.map((item, index) =>
    snapshotString(item, `${path}[${index}]`, 256),
  );
}

export function validateUsageSnapshot(value: unknown): UsageSnapshot {
  try {
    if (JSON.stringify(value) === undefined) {
      invalidSnapshot("snapshot must be JSON serializable");
    }
  } catch {
    invalidSnapshot("snapshot must be JSON serializable");
  }

  const root = snapshotObject(value, "snapshot");
  snapshotExactKeys(
    root,
    [
      "schemaVersion",
      "configVersion",
      "approved",
      "summary",
      "observations",
      "caveats",
      "nextDecision",
    ],
    "snapshot",
  );
  if (root.schemaVersion !== USAGE_SNAPSHOT_SCHEMA_VERSION) {
    invalidSnapshot(
      `snapshot.schemaVersion must be ${USAGE_SNAPSHOT_SCHEMA_VERSION}`,
    );
  }
  if (
    typeof root.configVersion !== "number" ||
    !Number.isSafeInteger(root.configVersion) ||
    root.configVersion < 1
  ) {
    invalidSnapshot("snapshot.configVersion must be a positive integer");
  }
  if (root.approved !== true) {
    invalidSnapshot("snapshot.approved must be true");
  }
  return {
    schemaVersion: USAGE_SNAPSHOT_SCHEMA_VERSION,
    configVersion: root.configVersion,
    approved: true,
    summary: snapshotString(root.summary, "snapshot.summary", 512),
    observations: snapshotStringList(
      root.observations,
      "snapshot.observations",
    ),
    caveats: snapshotStringList(root.caveats, "snapshot.caveats"),
    nextDecision: snapshotString(
      root.nextDecision,
      "snapshot.nextDecision",
      512,
    ),
  };
}

export function readUsageConfig(
  cwd: string,
  file = DEFAULT_USAGE_FILE,
): { config: UsageConfig; path: string } {
  const path = resolve(cwd, file);
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new CliError(`Could not read product analytics config ${path}: ${detail}`);
  }
  return { config: validateUsageConfig(parsed), path };
}

export function readUsageSnapshot(
  cwd: string,
  file = DEFAULT_USAGE_SNAPSHOT_FILE,
): { snapshot: UsageSnapshot; path: string } {
  const path = resolve(cwd, file);
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new CliError(
      `Could not read product analytics snapshot ${path}: ${detail}`,
    );
  }
  return { snapshot: validateUsageSnapshot(parsed), path };
}

export function validateProjectId(value: string): string {
  if (!UUID_PATTERN.test(value)) {
    throw new CliError("A valid project id is required.");
  }
  return value;
}
