/**
 * Dependency-free, server-only tracker for the detect-pmf skill.
 *
 * Copy this file into the application and call it only after an authoritative
 * business transition succeeds. The DSN is browser-safe; no workspace or
 * ingest token belongs in this module.
 */

const SKILL = "detect-pmf";
const DSN_HEADER = "X-Volato-DSN";

export type PmfPropertyType = "string" | "number" | "boolean";
export type PmfEventDefinition = {
  readonly name: string;
  readonly description: string;
  readonly properties: Readonly<Record<string, PmfPropertyType>>;
  readonly dedupe: "actor" | "key" | "none";
};

type PropertyValue<Type extends PmfPropertyType> =
  Type extends "string"
    ? string
    : Type extends "number"
      ? number
      : boolean;

type EventProperties<Event extends PmfEventDefinition> = {
  [Key in keyof Event["properties"]]: PropertyValue<
    Event["properties"][Key]
  >;
};

type PropertyInput<Event extends PmfEventDefinition> =
  keyof Event["properties"] extends never
    ? { properties?: Record<string, never> }
    : { properties: EventProperties<Event> };

type DedupeInput<Event extends PmfEventDefinition> =
  Event["dedupe"] extends "key"
    ? { dedupeKey: string }
    : { dedupeKey?: never };

export type PmfTrackInput<Event extends PmfEventDefinition> = {
  actorId: string;
  occurredAt?: string;
} & PropertyInput<Event> &
  DedupeInput<Event>;

export type PmfTracker<
  Events extends readonly PmfEventDefinition[],
> = {
  track<Name extends Events[number]["name"]>(
    event: Name,
    input: PmfTrackInput<Extract<Events[number], { name: Name }>>,
  ): Promise<boolean>;
};

export type CreatePmfTrackerOptions<
  Events extends readonly PmfEventDefinition[],
> = {
  dsn: string;
  events: Events;
  fetch?: typeof globalThis.fetch;
};

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
    throw new Error(`${path} must be 1-${maxLength} characters`);
  }
  return value;
}

function ingestUrl(dsn: string): string {
  const url = new URL(dsn);
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("Volato DSN protocol must be http or https");
  }
  if (!url.username || url.password) {
    throw new Error("Volato DSN must contain one public key");
  }
  const projectId = url.pathname.replace(/^\/+/, "").replace(/\/+$/, "");
  if (!projectId || projectId.includes("/")) {
    throw new Error("Volato DSN must contain one project id");
  }
  return `${url.origin}/api/skill-events`;
}

function timestamp(value: string | undefined): string {
  const occurredAt = value ?? new Date().toISOString();
  const parsed = new Date(occurredAt);
  if (
    occurredAt.length > 40 ||
    !Number.isFinite(parsed.getTime()) ||
    parsed.toISOString() !== occurredAt
  ) {
    throw new Error("occurredAt must be an ISO-8601 UTC timestamp");
  }
  return occurredAt;
}

function validatedProperties(
  definition: PmfEventDefinition,
  value: unknown,
): Record<string, string | number | boolean> {
  const properties =
    value === undefined ? {} : value;
  if (
    properties === null ||
    typeof properties !== "object" ||
    Array.isArray(properties)
  ) {
    throw new Error("properties must be an object");
  }

  const raw = properties as Record<string, unknown>;
  for (const key of Object.keys(raw)) {
    if (!(key in definition.properties)) {
      throw new Error(`properties.${key} is not declared`);
    }
  }

  const validated: Record<string, string | number | boolean> = {};
  for (const [key, expectedType] of Object.entries(
    definition.properties,
  )) {
    const property = raw[key];
    if (typeof property !== expectedType) {
      throw new Error(`properties.${key} must be a ${expectedType}`);
    }
    if (
      typeof property === "string" &&
      (property.length === 0 || property.length > 256)
    ) {
      throw new Error(`properties.${key} must be 1-256 characters`);
    }
    if (
      typeof property === "number" &&
      (!Number.isFinite(property) ||
        Math.abs(property) > Number.MAX_SAFE_INTEGER)
    ) {
      throw new Error(`properties.${key} must be a finite safe number`);
    }
    validated[key] = property as string | number | boolean;
  }
  return validated;
}

async function rejectionReason(response: Response): Promise<string> {
  const header = response.headers.get("X-Volato-Reason");
  if (header && /^[a-z0-9_-]{1,64}$/.test(header)) return header;
  try {
    const body = (await response.json()) as { error?: unknown };
    if (
      typeof body.error === "string" &&
      /^[a-z0-9_-]{1,64}$/.test(body.error)
    ) {
      return body.error;
    }
  } catch {
    // The status remains actionable even when a proxy returns a non-JSON body.
  }
  return "request_rejected";
}

function rejectionMessage(status: number, reason: string): string {
  const prefix = `[volato:detect-pmf] event rejected (${status}: ${reason}).`;
  if (reason === "skill_not_configured") {
    return `${prefix} Run \`volato pmf sync\` and retry the transition.`;
  }
  if (reason === "event_not_declared") {
    return `${prefix} Update .volato/pmf.json, then run \`volato pmf validate\` and \`volato pmf sync\`.`;
  }
  return `${prefix} Run \`volato pmf validate\`, sync the catalog, and inspect ingest health.`;
}

export function createPmfTracker<
  const Events extends readonly PmfEventDefinition[],
>(
  options: CreatePmfTrackerOptions<Events>,
): PmfTracker<Events> {
  const endpoint = ingestUrl(options.dsn);
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const catalog = new Map<string, PmfEventDefinition>();
  const warnedReasons = new Set<string>();
  const warnOnce = (reason: string, message: string): void => {
    if (warnedReasons.has(reason)) return;
    warnedReasons.add(reason);
    console.warn(message);
  };
  for (const definition of options.events) {
    if (catalog.has(definition.name)) {
      throw new Error(`PMF event ${JSON.stringify(definition.name)} is duplicated`);
    }
    catalog.set(definition.name, definition);
  }

  return {
    async track(event, input): Promise<boolean> {
      const definition = catalog.get(event);
      if (!definition) {
        throw new Error(`PMF event ${JSON.stringify(event)} is not declared`);
      }

      const actorId = boundedString(input.actorId, "actorId", 128);
      const properties = validatedProperties(
        definition,
        input.properties,
      );
      let dedupeKey: string | undefined;
      if (definition.dedupe === "key") {
        dedupeKey = boundedString(input.dedupeKey, "dedupeKey", 128);
      } else if (input.dedupeKey !== undefined) {
        throw new Error(
          `dedupeKey is not allowed when dedupe is ${definition.dedupe}`,
        );
      }

      const payload = {
        schemaVersion: 1,
        skill: SKILL,
        event,
        actorId,
        occurredAt: timestamp(input.occurredAt),
        ...(dedupeKey ? { dedupeKey } : {}),
        properties,
      };

      try {
        const response = await fetchImpl(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            [DSN_HEADER]: options.dsn,
          },
          body: JSON.stringify(payload),
        });
        if (response.ok) return true;
        const reason = await rejectionReason(response);
        warnOnce(
          `http:${response.status}:${reason}`,
          rejectionMessage(response.status, reason),
        );
      } catch {
        warnOnce(
          "network",
          "[volato:detect-pmf] event delivery failed. Verify the ingest endpoint is reachable; the product transition was not interrupted.",
        );
      }
      return false;
    },
  };
}
