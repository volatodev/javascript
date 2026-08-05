# Volato Product Analytics contract

## Project catalog

`.volato/analytics.json` is the source-controlled, versioned source of truth:

```json
{
  "schemaVersion": 1,
  "projectId": "11111111-1111-4111-8111-111111111111",
  "product": {
    "summary": "The product offers several workflows for completing one job.",
    "targetActor": "Operators trying to complete that job."
  },
  "job": {
    "statement": "Help an operator complete a painful workflow.",
    "outcome": "The operator receives the promised result."
  },
  "events": [
    {
      "name": "eligible_actor_entered",
      "description": "An eligible actor enters the product.",
      "properties": {},
      "dedupe": "actor"
    },
    {
      "name": "email_verified",
      "description": "The actor clears the mandatory verification gate.",
      "properties": {},
      "dedupe": "actor"
    },
    {
      "name": "setup_completed",
      "description": "The actor completes setup shared by every workflow.",
      "properties": {},
      "dedupe": "actor"
    },
    {
      "name": "workflow_started",
      "description": "An actor starts one of the product workflows.",
      "properties": {
        "workflow": {
          "type": "enum",
          "values": ["workflow-a", "workflow-b"]
        }
      },
      "dedupe": "key"
    },
    {
      "name": "outcome_delivered",
      "description": "A workflow delivers its promised result.",
      "properties": {
        "workflow": {
          "type": "enum",
          "values": ["workflow-a", "workflow-b"]
        }
      },
      "dedupe": "key"
    }
  ],
  "milestones": [
    {
      "event": "eligible_actor_entered",
      "question": "Did an eligible actor enter the product?"
    },
    {
      "event": "email_verified",
      "question": "Did the actor clear the mandatory verification gate?"
    },
    {
      "event": "setup_completed",
      "question": "Did the actor complete shared setup?"
    },
    {
      "event": "workflow_started",
      "question": "Did the actor start a workflow?"
    },
    {
      "event": "outcome_delivered",
      "question": "Did the workflow deliver its promised result?"
    }
  ]
}
```

The document declares what is captured and in which order it is expected to
happen, and nothing else. Conversion, time to value and return are computed from
each actor's timeline when the report is read: a founder cannot choose an honest
cohort window before seeing any data, and a ratio over three actors says less
than the three timelines themselves. `cohort`, `activation`, `repeat`,
`retention` and `branches` are no longer part of the contract and are rejected
as unsupported fields.

The legacy shape without `product` and `milestones` is rejected; there is no
compatibility mode. No additional fields are accepted. The complete JSON
document must be at most 32 KiB in UTF-8. The project id is a UUID version 1-5.
`product.summary` is 1-512 characters.
`product.targetActor`, job fields, milestone questions, and event descriptions
are 1-256 characters.

The catalog contains one or more events. Its size is bounded by the 32 KiB
document limit, not by an arbitrary event count. Event names are 1-64
characters matching `[a-z][a-z0-9_-]*`. Dedupe is `actor`, `key`, or `none`.

Event properties are either `{}` or strict enum definitions:

```json
{
  "workflow": {
    "type": "enum",
    "values": ["workflow-a", "workflow-b"]
  }
}
```

Property names and enum values are 1-64 characters matching
`[a-z][a-z0-9_-]*`. Enum values are non-empty and unique. Each definition has
exactly `type` and `values`; strings, fallback fields and free-form property
types are rejected.

Use an enum only when the same action has finite, stable product variants.
Use different events for different actions. The skill proposes the values from
the customer's product and obtains explicit founder approval; neither the
backend nor the tracker owns a universal value list.

Use `dedupe: key` when the same actor can legitimately repeat the same action;
use `dedupe: actor` for a one-time fact.

The catalog contains at least two ordered milestones with unique event
references, each referencing an event in the catalog. There is no maximum: the
32 KiB document is the honest limit, and a journey that genuinely needs nine
steps should not be told that eight is a law. The order is the contract's only
claim about the journey — first milestone first, delivered value last — and it
is what lets a report say an actor stalled at step four.

## CLI control plane

The authenticated CLI uses the workspace credential without exposing it:

```text
volato analytics validate
volato analytics sync
volato analytics report
volato analytics snapshot save
```

- Validate is local-only.
- Sync publishes the full versioned document to the Analytics domain of the
  project linked by `volato init`.
- Report reads Analytics evidence for that same linked project.
- Snapshot save validates `.volato/analytics-snapshot.json`, then publishes the
  approved document with one `Idempotency-Key` per invocation.
- The config project id must match `.volato/manifest.json`; commands never
  silently route to another project.
- Markdown is the default output; pass `--json` for structured output.

Snapshot save is an explicit approval boundary, never an automatic report
side effect:

```json
{
  "schemaVersion": 1,
  "configVersion": 3,
  "approved": true,
  "summary": "Eligible actors are reaching the promised outcome.",
  "observations": ["Four eligible actors activated in this cohort."],
  "caveats": ["The repeat-use window is still immature."],
  "nextDecision": "Wait for repeat maturity, then review the same cohort."
}
```

`configVersion` is a positive integer and must identify the active config.
Summary and next decision are 1-512 characters. Observations and caveats
contain at most eight 1-256 character strings. All keys are exact. The agent
proposes this behavioral snapshot from
`volato analytics report`, obtains explicit founder approval, then saves it. Without
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
  "skill": "monitor-product-usage",
  "event": "outcome_delivered",
  "actorId": "opaque_internal_actor_id",
  "occurredAt": "2026-07-29T16:00:00.000Z",
  "dedupeKey": "stable_business_transition_id",
  "properties": {
    "workflow": "workflow-a"
  }
}
```

The generated tracker supplies the internal domain discriminator shown above;
application code never sets it. The project id is derived from the DSN; do not
send `projectId` or `tenantId`.
The DSN selects the project and derives the ingest origin. The server-only
`VOLATO_INGEST_TOKEN` authorizes the write and must match that project. The
tracker reads both `NEXT_PUBLIC_VOLATO_DSN` and `VOLATO_INGEST_TOKEN`, which
`volato analytics init` already writes to the protected `.env.local`. Never use
the workspace token, never add a third credential, and never send with the DSN
alone.

Emit only after the authoritative business write commits. Await the returned
promise or register it with a request-lifetime hook:

```ts
export async function deliverOutcome(
  input: OutcomeInput,
  runtime: { waitUntil(promise: Promise<unknown>): void },
) {
  const outcome = await deliverAndCommit(input);

  runtime.waitUntil(
    analytics.track("outcome_delivered", {
      actorId: outcome.actorId,
      dedupeKey: outcome.transitionId,
      properties: { workflow: outcome.workflow },
    }),
  );

  return outcome;
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
forbid it. `properties` must contain exactly the keys declared for the event;
each value is one of its configured enum strings. Missing, unknown,
out-of-enum and free-form values are rejected locally. Config, event-envelope
and snapshot `schemaVersion` are each 1 and version their own document shape.

The report is derived, never declared. It rebuilds each actor's ordered timeline
from the stored events, then reports where that actor stands and since when;
conversion between milestones, time to first value and return to a delivered
outcome follow from those timelines. Enum properties are carried through, so the
same evidence can be read per value, but no value list, window, threshold or
ratio is stored in the config.

The tracker is server-only, adds a two-second `AbortSignal` timeout, and never
rejects: invalid configuration, invalid input, a missing token, an ingest
rejection, or a network failure resolves to `false` and emits one warning per
reason. Capture must complete or scream through that warning.
