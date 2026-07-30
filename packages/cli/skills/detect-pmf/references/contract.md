# Detect-PMF contract

## Project catalog

`.volato/pmf.json` is the source-controlled, versioned source of truth:

```json
{
  "schemaVersion": 1,
  "projectId": "11111111-1111-4111-8111-111111111111",
  "skill": "detect-pmf",
  "product": {
    "summary": "Volato gives coding agents production context.",
    "targetActor": "Developers fixing production software with a coding agent."
  },
  "job": {
    "statement": "Help a developer restore a failing production workflow.",
    "outcome": "The developer resolves a real production error."
  },
  "events": [
    {
      "name": "eligible_account_created",
      "description": "An eligible account enters the measurement cohort.",
      "properties": {},
      "dedupe": "actor"
    },
    {
      "name": "production_error_resolved",
      "description": "A production error is resolved through the product loop.",
      "properties": {},
      "dedupe": "key"
    }
  ],
  "milestones": [
    {
      "event": "eligible_account_created",
      "question": "Did an eligible developer enter the cohort?"
    },
    {
      "event": "production_error_resolved",
      "question": "Did the developer resolve a real production error?"
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

The legacy shape without `product` and `milestones` is rejected; there is no
compatibility mode. No additional fields are accepted. The complete JSON
document must be at most 32 KiB in UTF-8. The project id is a UUID version 1-5.
`product.summary` is 1-512 characters.
`product.targetActor`, job fields, milestone questions, and event descriptions
are 1-256 characters.

The catalog contains 1-32 events. Event names are 1-64 characters matching
`[a-z][a-z0-9_-]*`. Every event must declare exactly
`"properties": {}`. Dedupe is `actor`, `key`, or `none`.

The catalog contains 2-8 ordered milestones with unique event references. The
first milestone is `cohort.event`; the last is `activation.event`.

`cohort.windowDays` is 1-90 and must be at least `retention.maxDays`.
`repeat.minHours` is 24-2160. Retention values are 1-90 and `maxDays` must be
greater than `minDays`. Every metric event references the event catalog.

## CLI control plane

The authenticated CLI uses the workspace credential without exposing it:

```text
volato pmf validate
volato pmf sync
volato pmf report
volato pmf assessment save
```

- Validate is local-only.
- Sync posts `{ "schemaVersion": 1, "config": <full document> }` to
  `/v1/projects/:projectId/skills/detect-pmf/config`.
- Report reads `/v1/projects/:projectId/skills/detect-pmf/report`.
- Assessment save validates `.volato/pmf-assessment.json`, then posts the
  document directly to
  `/v1/projects/:projectId/skills/detect-pmf/assessments`. The CLI creates one
  `Idempotency-Key` per invocation and reuses it for automatic retries.
- `--project-id` may override the project id for a command.
- Markdown is the default output; pass `--json` for structured output.

Assessment save is an explicit approval boundary, never an automatic report
side effect:

```json
{
  "schemaVersion": 1,
  "configVersion": 3,
  "approved": true,
  "status": "promising_signal",
  "summary": "Eligible actors are reaching the promised outcome.",
  "observations": ["Four eligible actors activated in this cohort."],
  "caveats": ["The repeat-use window is still immature."],
  "nextDecision": "Wait for repeat maturity, then review the same cohort."
}
```

`configVersion` is a positive integer and must identify the active config.
Status is `insufficient_data`, `weak_signal`, `promising_signal`, or
`strong_behavioral_signal`. Summary and next decision are 1-512 characters.
Observations and caveats contain at most eight 1-256 character strings. All
keys are exact. The agent proposes this behavioral assessment from
`volato pmf report`, obtains explicit founder approval, then saves it. Without
approval, it stops.

## Event data plane

Post to the origin encoded by the project's public DSN:

```text
POST /api/skill-events
Content-Type: application/json
X-Volato-DSN: <public DSN>
Authorization: Bearer <server ingest token>
```

```json
{
  "schemaVersion": 1,
  "skill": "detect-pmf",
  "event": "production_error_resolved",
  "actorId": "opaque_internal_actor_id",
  "occurredAt": "2026-07-29T16:00:00.000Z",
  "dedupeKey": "stable_business_transition_id",
  "properties": {}
}
```

The project id is derived from the DSN; do not send `projectId` or `tenantId`.
The DSN selects the project and derives the ingest origin. The server-only
`VOLATO_INGEST_TOKEN` authorizes the write and must match that project. The
tracker reads both `NEXT_PUBLIC_VOLATO_DSN` and `VOLATO_INGEST_TOKEN`, which
`volato init --project` already writes to the protected `.env.local`. Never use
the workspace token, never add a third credential, and never send with the DSN
alone.

Emit only after the authoritative business write commits. Await the returned
promise or register it with a request-lifetime hook:

```ts
export async function resolveProductionError(
  input: ResolveInput,
  runtime: { waitUntil(promise: Promise<unknown>): void },
) {
  const resolution = await resolveAndCommit(input);

  runtime.waitUntil(
    pmfTracker.track("production_error_resolved", {
      actorId: resolution.actorId,
      dedupeKey: resolution.errorGroupId,
    }),
  );

  return resolution;
}
```

Do not put the tracker call inside the transaction. Use `waitUntil`, `after`, or
the runtime's equivalent when the response must return immediately; otherwise
await the promise after commit. Never discard it with `void`. The boolean
delivery result is diagnostic; rejected or unreachable ingest emits one
actionable warning per reason without changing the committed transition.

`actorId` is 1-128 characters matching
`[A-Za-z0-9][A-Za-z0-9._:-]{0,127}`; email addresses and values containing `@`
are rejected locally. `occurredAt` is a canonical ISO-8601 UTC timestamp. A
key-deduped event requires a 1-128 character `dedupeKey`; other dedupe modes
forbid it. `properties` is always `{}`. Config, event-envelope and assessment
`schemaVersion` are each 1 and version their own document shape.

The tracker is server-only, adds a two-second `AbortSignal` timeout, and never
rejects: invalid configuration, invalid input, a missing token, an ingest
rejection, or a network failure resolves to `false` and emits one warning per
reason. Capture must complete or scream through that warning.
