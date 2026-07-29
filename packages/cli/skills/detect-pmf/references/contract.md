# Detect-PMF contract

## Project catalog

`.volato/pmf.json` is the source-controlled, versioned source of truth:

```json
{
  "schemaVersion": 1,
  "projectId": "11111111-1111-4111-8111-111111111111",
  "skill": "detect-pmf",
  "job": {
    "statement": "Help a developer restore a failing production workflow.",
    "outcome": "The developer resolves a real production error."
  },
  "events": [
    {
      "name": "eligible_account_created",
      "description": "An eligible account enters the measurement cohort.",
      "properties": {
        "source": "string"
      },
      "dedupe": "actor"
    },
    {
      "name": "production_error_resolved",
      "description": "A production error is resolved through the product loop.",
      "properties": {
        "plan": "string"
      },
      "dedupe": "key"
    }
  ],
  "cohort": {
    "event": "eligible_account_created",
    "windowDays": 90
  },
  "activation": {
    "event": "production_error_resolved"
  },
  "repeat": {
    "event": "production_error_resolved",
    "minHours": 24
  },
  "retention": {
    "event": "production_error_resolved",
    "minDays": 7,
    "maxDays": 35
  }
}
```

No additional fields are accepted. The complete JSON document must be at most
32 KiB. The project id is a UUID version 1-5. Job fields and event descriptions
are 1-256 characters.

The catalog contains 1-32 events. Event names are 1-64 characters matching
`[a-z][a-z0-9_-]*`. Each event has at most 12 properties. Property keys are
1-48 characters matching `[a-z][a-z0-9_]*`; property types are `string`,
`number`, or `boolean`. Dedupe is `actor`, `key`, or `none`.

`cohort.windowDays` is 1-90 and must be at least `retention.maxDays`.
`repeat.minHours` is 24-2160. Retention values are 1-90 and `maxDays` must be
greater than `minDays`. Every metric event references the event catalog.

## CLI control plane

The authenticated CLI uses the workspace credential without exposing it:

```text
volato pmf validate
volato pmf sync
volato pmf report
```

- Validate is local-only.
- Sync posts `{ "schemaVersion": 1, "config": <full document> }` to
  `/v1/projects/:projectId/skills/detect-pmf/config`.
- Report reads `/v1/projects/:projectId/skills/detect-pmf/report`.
- `--project-id` may override the project id for a command.
- Markdown is the default output; pass `--json` for structured output.

## Event data plane

Post to the origin encoded by the project's public DSN:

```text
POST /api/skill-events
Content-Type: application/json
X-Volato-DSN: <public DSN>
```

```json
{
  "schemaVersion": 1,
  "skill": "detect-pmf",
  "event": "production_error_resolved",
  "actorId": "opaque_internal_actor_id",
  "occurredAt": "2026-07-29T16:00:00.000Z",
  "dedupeKey": "stable_business_transition_id",
  "properties": {
    "plan": "pro"
  }
}
```

The project id is derived from the DSN; do not send `projectId` or `tenantId`.
The DSN is browser-safe and selects a project. It is not a server credential.
Never use a workspace token or ingest token for product events.

Emit only after the authoritative business write commits, and detach telemetry
from the response path:

```ts
export async function resolveProductionError(input: ResolveInput) {
  const resolution = await resolveAndCommit(input);

  void pmfTracker.track("production_error_resolved", {
    actorId: resolution.actorId,
    dedupeKey: resolution.errorGroupId,
    properties: { plan: resolution.plan },
  });

  return resolution;
}
```

Do not put the tracker call inside the transaction and do not `await` it before
returning the product response. The boolean delivery result is diagnostic only;
the tracker reports rejected or unreachable ingest once per reason without
changing the committed transition.

`actorId` is 1-128 characters. `occurredAt` is a canonical ISO-8601 UTC
timestamp. A key-deduped event requires a 1-128 character `dedupeKey`; other
dedupe modes forbid it. All declared properties are required, undeclared
properties are rejected, strings are 1-256 characters, and numbers must be
finite safe values.
