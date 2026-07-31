---
name: monitor-product-usage
description: Inspect a product, define the smallest outcome-led usage map, install privacy-minimal server-side probes, and interpret activation, time-to-value, repeat and retention through Volato. Use when a founder or product team asks what users actually do, where delivered value stalls, whether users repeat a valuable outcome, how finite workflows compare, or which product-usage signal should drive the next decision.
---

# Monitor product usage

## Keep the claim honest

Monitor whether eligible actors receive and repeat the product's promised
value. Do not claim to detect product-market fit. Usage events cannot establish
why users act, how disappointed they would be without the product, willingness
to pay, market size or distribution pull.

Do not turn this skill into generic analytics. Reject page views, clicks,
session length and aggregate event volume unless one is required to distinguish
two product decisions. Keep the agent as the interface: do not build a
dashboard, admin route, chart or event explorer.

## Work from decisions to probes

Before editing code, inspect the product and propose:

1. **Goal** — the product decision or improvement under consideration.
2. **Actor and job** — who has the problem and what progress they seek.
3. **Outcome** — the smallest server-observable fact proving delivered value.
4. **Opportunity** — when that actor had a fair chance to receive the value.
5. **Cadence** — daily, weekly, monthly or episodic recurrence.
6. **Signals** — behaviors that would change if the goal were achieved.
7. **Metrics** — normalized ratios or delays representing those signals.
8. **Action** — what the founder will do if evidence rises, falls or remains
   immature.

Obtain explicit founder approval for the complete map before writing config or
instrumentation. Remove any event that does not support a named decision.

Use the smallest useful value loop:

```text
eligible actor
    → attempt or diagnostic milestone, only when it localises a distinct block
    → first value delivered
    → later value opportunity
    → value delivered again
```

Calendar windows are valid only when they match the job's natural cadence. For
an episodic job, determine whether the next eligible opportunity is observable.
The current contract supports elapsed-time windows only; if that would
misrepresent the job, state the capability gap instead of reporting weak
retention.

## Maintain the usage contract

Read [references/contract.md](references/contract.md) before writing
`.volato/usage.json`. Record:

- product summary, target actor, job and delivered outcome;
- two to eight ordered milestones from eligible cohort to first value;
- a closed event catalog with server-owned triggers;
- repeat and retention events with founder-approved elapsed-time windows;
- optional branches for finite variants of the same action.

Branches must share the same outcome, opportunity and cadence. Do not compare a
daily workflow with a quarterly workflow as if their retention meant the same
thing. When an actor can use several branches, report same-branch repeat as
recurring value and cross-branch repeat as catalog breadth; the counts may
overlap.

For every event, document in the approval proposal:

- the decision or product question it supports;
- the authoritative business transition;
- the pseudonymous actor identifier;
- whether it is a one-time fact or repeatable value;
- its dedupe strategy and deletion behavior.

Properties are empty objects or strict, finite enums. Never send names, email
addresses, identifiers as properties, arbitrary text, URLs with query strings,
errors, tokens or other user content. Use separate events for different
actions. Use one enum only for stable variants whose comparison changes a
decision.

Run `volato usage validate`, then `volato usage sync` before deploying or
exercising any event. Sync establishes the contract; it does not prove that
delivery works.

## Install trustworthy instrumentation

Copy [assets/usage-tracker.ts](assets/usage-tracker.ts) into a server-only
application module and create an `as const` event catalog identical to
`.volato/usage.json`.

The tracker reuses `NEXT_PUBLIC_VOLATO_DSN` for routing and
`VOLATO_INGEST_TOKEN` for authorization. Do not add another credential or send
with the DSN alone. Emit only after the durable business transition commits.
Await the delivery promise or register it with the runtime's supported
lifetime hook; never detach it with `void`.

Run focused tests and a production build. Exercise at least one real path and
verify the request reaches `/api/skill-events` with `X-Volato-DSN` and the
server bearer without printing either value.

## Interpret the report

Run `volato usage report` and read it in this order:

1. **Observability** — active config, exercised probes, delivery failures and
   any break in comparability.
2. **Maturity** — cohort sizes and windows that have actually elapsed.
3. **First value** — milestone conversion, activation and time-to-value.
4. **Recurrence** — repeat and retention at the declared cadence.
5. **Branches** — interest, delivered outcome, same-branch repeat and breadth.
6. **Change** — difference from a comparable config or prior snapshot.
7. **Decision** — the main bottleneck and smallest next action or probe.

Exclude immature actors from repeat and retention denominators. Treat a config,
event definition or tracking change as a comparability break. Small samples are
directional, not proof.

AARRR is an optional growth reading, not the event schema. Add acquisition,
referral or revenue only when attribution, invitation and billing sources exist
and the user asks that question. North Star inputs such as breadth, depth,
frequency and efficiency may help interpret a stable product, but do not invent
them from missing data.

## Save an approved snapshot

Draft `.volato/usage-snapshot.json` from the current report with a concise
summary, observations, caveats and next decision. Do not assign a PMF score or
status. Show the draft to the founder and run `volato usage snapshot save` only
after explicit approval. Never save an interpretation automatically.

## Completion criteria

Return:

1. the goal, actor, job, outcome, opportunity unit and natural cadence;
2. the event map with keep, add and remove decisions;
3. approved `.volato/usage.json` and instrumentation changes;
4. validation, sync, tests, build and exercised-path results;
5. current activation, time-to-value, repeat, retention and branch evidence;
6. data-quality, privacy, maturity and comparability limits;
7. the proposed snapshot, approval state and save result;
8. one next product decision and the smallest measurement change it requires.
