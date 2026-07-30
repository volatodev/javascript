/**
 * Dependency-free, server-only tracker for the detect-pmf skill.
 *
 * Copy this file into the application and call it only after an authoritative
 * business transition succeeds. It reads the public DSN for routing and the
 * server-only ingest token for write authorization. Never hard-code either
 * value in source.
 */

const SKILL = "detect-pmf";
const DSN_HEADER = "X-Volato-DSN";
const DELIVERY_TIMEOUT_MS = 2_000;
const ACTOR_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const KEY_PATTERN = /^[a-z][a-z0-9_-]{0,63}$/;

export type PmfEnumDefinition = {
  readonly type: "enum";
  readonly values: readonly string[];
};

export type PmfEventDefinition = {
  readonly name: string;
  readonly description: string;
  readonly properties: Readonly<Record<string, PmfEnumDefinition>>;
  readonly dedupe: "actor" | "key" | "none";
};

type EnumValue<Definition> =
  Definition extends { readonly values: readonly (infer Value extends string)[] }
    ? Value
    : never;

type EventProperties<Event extends PmfEventDefinition> = {
  [Key in keyof Event["properties"]]: EnumValue<Event["properties"][Key]>;
};

type DedupeInput<Event extends PmfEventDefinition> =
  Event["dedupe"] extends "key"
    ? { dedupeKey: string }
    : { dedupeKey?: never };

export type PmfTrackInput<Event extends PmfEventDefinition> = {
  actorId: string;
  occurredAt?: string;
} &
  (keyof Event["properties"] extends never
    ? { properties?: Record<string, never> }
    : { properties: EventProperties<Event> }) &
  DedupeInput<Event>;

export type PmfTracker<
  Events extends readonly PmfEventDefinition[],
> = {
  /**
   * Await this promise or register it with the runtime's request-lifetime
   * hook. Do not discard it: delivery must complete or produce a warning.
   */
  track<Name extends Events[number]["name"]>(
    event: Name,
    input: PmfTrackInput<Extract<Events[number], { name: Name }>>,
  ): Promise<boolean>;
};

export type CreatePmfTrackerOptions<
  Events extends readonly PmfEventDefinition[],
> = {
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

function actorId(value: unknown): string {
  const id = boundedString(value, "actorId", 128);
  if (!ACTOR_ID_PATTERN.test(id)) {
    throw new Error(
      "actorId must start with an alphanumeric character and contain only letters, digits, dot, underscore, colon or hyphen",
    );
  }
  return id;
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
  value: unknown,
  definitions: Readonly<Record<string, PmfEnumDefinition>>,
): Record<string, string> {
  const properties = value === undefined ? {} : value;
  if (
    properties === null ||
    typeof properties !== "object" ||
    Array.isArray(properties)
  ) {
    throw new Error("properties must be an object");
  }

  const raw = properties as Record<string, unknown>;
  const expectedKeys = Object.keys(definitions);
  const unknownKey = Object.keys(raw).find(
    (key) => !Object.prototype.hasOwnProperty.call(definitions, key),
  );
  if (unknownKey) {
    throw new Error(`properties.${unknownKey} is not declared`);
  }
  const missingKey = expectedKeys.find(
    (key) => !Object.prototype.hasOwnProperty.call(raw, key),
  );
  if (missingKey) {
    throw new Error(`properties.${missingKey} is required`);
  }

  const validated: Record<string, string> = {};
  for (const key of expectedKeys) {
    const value = raw[key];
    const definition = definitions[key]!;
    if (
      typeof value !== "string" ||
      !definition.values.includes(value)
    ) {
      throw new Error(
        `properties.${key} must be one of ${definition.values.join(", ")}`,
      );
    }
    validated[key] = value;
  }
  return validated;
}

function validatePropertyDefinitions(
  definitions: unknown,
  eventName: string,
): string | undefined {
  if (
    definitions === null ||
    typeof definitions !== "object" ||
    Array.isArray(definitions)
  ) {
    return `PMF event ${JSON.stringify(eventName)} properties must be an object`;
  }
  for (const [key, rawDefinition] of Object.entries(
    definitions as Record<string, unknown>,
  )) {
    if (!KEY_PATTERN.test(key)) {
      return `PMF event ${JSON.stringify(eventName)} property ${JSON.stringify(key)} has an invalid name`;
    }
    if (
      rawDefinition === null ||
      typeof rawDefinition !== "object" ||
      Array.isArray(rawDefinition)
    ) {
      return `PMF event ${JSON.stringify(eventName)} property ${JSON.stringify(key)} must be an enum definition`;
    }
    const definition = rawDefinition as Record<string, unknown>;
    const keys = Object.keys(definition);
    if (
      keys.length !== 2 ||
      !keys.includes("type") ||
      !keys.includes("values") ||
      definition.type !== "enum" ||
      !Array.isArray(definition.values) ||
      definition.values.length === 0
    ) {
      return `PMF event ${JSON.stringify(eventName)} property ${JSON.stringify(key)} must be a strict enum definition`;
    }
    const values = Array.from(definition.values);
    if (
      values.some(
        (value) =>
          typeof value !== "string" ||
          !KEY_PATTERN.test(value),
      ) ||
      new Set(values).size !== values.length
    ) {
      return `PMF event ${JSON.stringify(eventName)} property ${JSON.stringify(key)} has invalid enum values`;
    }
  }
  return undefined;
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
  const dsn = process.env.NEXT_PUBLIC_VOLATO_DSN ?? "";
  const ingestToken = process.env.VOLATO_INGEST_TOKEN ?? "";
  const ingestTokenValid =
    ingestToken.length > 0 &&
    ingestToken.length <= 512 &&
    !/\s/.test(ingestToken);
  let endpoint: string | undefined;
  try {
    endpoint = ingestUrl(dsn);
  } catch {
    // Report configuration failures from track so delivery fails loudly.
  }
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const catalog = new Map<string, PmfEventDefinition>();
  let catalogError: string | undefined;
  const warnedReasons = new Set<string>();
  const warnOnce = (reason: string, message: string): void => {
    if (warnedReasons.has(reason)) return;
    warnedReasons.add(reason);
    try {
      if (typeof console !== "undefined" && console.warn) {
        console.warn(message);
      }
    } catch {
      // Diagnostics must never turn telemetry into a rejection.
    }
  };
  for (const definition of options.events) {
    const propertyError = validatePropertyDefinitions(
      definition.properties,
      definition.name,
    );
    if (propertyError) {
      catalogError = propertyError;
      break;
    }
    if (catalog.has(definition.name)) {
      catalogError = `PMF event ${JSON.stringify(definition.name)} is duplicated`;
      break;
    }
    catalog.set(definition.name, definition);
  }

  return {
    async track(event, input): Promise<boolean> {
      if (typeof window !== "undefined") {
        warnOnce(
          "browser_runtime",
          "[volato:detect-pmf] event delivery disabled: the PMF tracker is server-only. Move this call behind an authoritative server transition.",
        );
        return false;
      }
      if (!endpoint) {
        warnOnce(
          "invalid_dsn",
          "[volato:detect-pmf] event delivery disabled: NEXT_PUBLIC_VOLATO_DSN is missing or malformed. Run `volato init` for this project.",
        );
        return false;
      }
      if (!ingestTokenValid) {
        warnOnce(
          "invalid_ingest_token",
          "[volato:detect-pmf] event delivery disabled: VOLATO_INGEST_TOKEN is missing or malformed. Run `volato init` for this project.",
        );
        return false;
      }
      if (catalogError) {
        warnOnce(
          "invalid_catalog",
          `[volato:detect-pmf] event delivery disabled: ${catalogError}. Run \`volato pmf validate\`.`,
        );
        return false;
      }

      const definition = catalog.get(event);
      if (!definition) {
        warnOnce(
          "invalid_input",
          "[volato:detect-pmf] event not sent: its name is not declared. Update .volato/pmf.json and run `volato pmf sync`.",
        );
        return false;
      }

      let payload: {
        schemaVersion: number;
        skill: string;
        event: string;
        actorId: string;
        occurredAt: string;
        dedupeKey?: string;
        properties: Record<string, string>;
      };
      try {
        const validatedActorId = actorId(input.actorId);
        const properties = validatedProperties(
          input.properties,
          definition.properties,
        );
        let dedupeKey: string | undefined;
        if (definition.dedupe === "key") {
          dedupeKey = boundedString(input.dedupeKey, "dedupeKey", 128);
        } else if (input.dedupeKey !== undefined) {
          throw new Error(
            `dedupeKey is not allowed when dedupe is ${definition.dedupe}`,
          );
        }

        payload = {
          schemaVersion: 1,
          skill: SKILL,
          event,
          actorId: validatedActorId,
          occurredAt: timestamp(input.occurredAt),
          ...(dedupeKey ? { dedupeKey } : {}),
          properties,
        };
      } catch (error) {
        const reason =
          error instanceof Error ? error.message : "input is invalid";
        warnOnce(
          "invalid_input",
          `[volato:detect-pmf] event not sent: ${reason}. Validate the call against .volato/pmf.json.`,
        );
        return false;
      }

      try {
        const response = await fetchImpl(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            [DSN_HEADER]: dsn,
            Authorization: `Bearer ${ingestToken}`,
          },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
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
