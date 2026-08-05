---
name: volato-product
description: Inspect a product, define the smallest outcome-led usage map, install privacy-minimal server-side probes, and read where delivered value stalls or returns through Volato. Use when a founder or product team asks what users actually do, where delivered value stalls, whether users come back for a valuable outcome, or which product-usage signal should drive the next decision.
---

# Understand product usage

## Keep the claim honest

Monitor whether eligible actors receive and repeat the product's promised
value. Do not claim to detect product-market fit. Usage events cannot establish
why users act, how disappointed they would be without the product, willingness
to pay, market size or distribution pull.

Do not turn this skill into generic analytics. Reject page views, clicks,
session length and aggregate event volume unless one is required to distinguish
two product decisions. Keep the agent as the interface: do not build a
dashboard, admin route, chart or event explorer.

## Inspect the product before proposing

Read the code before naming a single milestone. A map invented from the landing
page or from the founder's summary measures the story of the product, not the
product. A milestone worth instrumenting is almost always one of three things in
the source, and they are worth hunting in this order.

**Mandatory gates first, because they pay the most and are missed the most.** A
gate is anything the product forces an actor through before it will do its job:
email or phone verification, an onboarding or paywall guard that redirects, a
plan or quota check that refuses the call, an approval or invitation the actor
cannot grant themselves. Every forced gate is a place where real people stop,
and an uninstrumented gate reads as apathy in the report when it is actually a
wall. Grep the auth configuration for `requireEmailVerification`,
`emailVerified`, `verificationRequired`, `confirmedAt` and the equivalents of
whatever library the product uses, then grep routing and layout code for
`redirect(`, `hasPermission`, `requireSubscription`, `checkQuota`, `402`, `403`
and `upgrade`. Read `middleware.ts` and every guarding `layout.tsx` end to end:
they encode the mandatory order of the journey more faithfully than any
documentation. When a flag such as `requireEmailVerification: true` is on,
verifying the email is a milestone — the actor cannot reach value without
crossing it, and the delay between signup and verification is a number the
founder can act on this week.

**Durable transitions second.** These are writes a reload cannot undo: rows
inserted, a status column moved to a terminal value, an external side effect
committed such as a payment captured, a message delivered or a job finished.
Grep for `insert(`, `.update(`, status transitions, migrations that add a state
column, and webhook handlers that mark work complete. Agents cover this layer
well unaided, so spend less time here — but hold the rule that the milestone is
the commit, never the intent that preceded it.

**Entry points outside the web interface third, because missing them
invalidates the whole map.** Ask explicitly whether the product can be used
without a browser: a CLI, a public API, an MCP server, inbound webhooks, a
scheduled job, an SDK running inside the customer's own code. Grep for `bin`
entries in `package.json`, CLI packages, `app/api/**/route.ts` handlers that
authenticate a token instead of a session, and any API-key or token table in the
schema. For a product whose real work happens in a terminal, a web login is not
evidence of usage and the first authenticated CLI command is. Instrument where
value is actually delivered; when that place has no server-side write today, say
so instead of substituting the nearest convenient web event.

Finish the inspection with a written list of candidate milestones and the exact
file and line where each one commits, then cut it down to the shortest ordered
path that still shows the founder where people stop.

## Work from decisions to probes

From that inspection, propose:

1. **Goal** — the product decision or improvement under consideration.
2. **Actor and job** — who has the problem and what progress they seek.
3. **Outcome** — the smallest server-observable fact proving delivered value.
4. **Order** — the milestones between eligibility and that outcome, each tied to
   the commit that proves it.
5. **Signals** — behaviors that would change if the goal were achieved.
6. **Action** — what the founder will do if evidence rises, falls or remains
   immature.

Two questions carry the interpretation without ever becoming fields:
**opportunity** — when did this actor get a fair chance to receive the value —
and **cadence** — how often the job comes back, daily, weekly, monthly or
episodic. Answer both in the approval proposal, because the report shows
timelines and only these answers turn a gap into either a block or a wait that
is not due yet.

Obtain explicit founder approval for the complete map before writing config or
instrumentation. Remove any event that does not support a named decision.

Use the smallest useful value loop:

```text
eligible actor
    → mandatory gate, whenever the product forces one
    → attempt or diagnostic milestone, only when it localises a distinct block
    → first value delivered
    → value delivered again
```

## Maintain the usage contract

Read [references/analytics-contract.md](references/analytics-contract.md) before
writing `.volato/analytics.json`. The document holds four things and nothing
else:

- product summary and target actor;
- job statement and delivered outcome;
- a closed event catalog with server-owned triggers;
- the ordered milestones the journey is expected to follow.

There is no cohort window, activation event, repeat rule, retention rule or
branch declaration to fill in, and no milestone ceiling: two is the minimum and
the 32 KiB document is the only maximum. Rates and delays are computed from each
actor's timeline when the report is read, because a founder cannot pick an
honest window before seeing data, and a ratio over three actors says less than
the three timelines themselves. Order is the point of the file — it is what lets
a report say an actor stalled at step four instead of listing unrelated facts.

A daily workflow and a quarterly workflow do not mean the same thing by the same
silence. Write that judgement into the approval proposal and the snapshot, never
into the config.

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

Run `volato analytics validate`, then `volato analytics init`. Init publishes
the approved contract, installs the generated Next.js tracker and records its
ownership in `.volato/manifest.json`. Sync establishes the contract; it does
not prove that delivery works.

## Install trustworthy instrumentation

Do not copy tracker code by hand. `volato analytics init` generates a
server-only tracker and an `as const` event catalog from
`.volato/analytics.json`. Inspect the generated files before placing the
product-specific probes.

The tracker reuses `NEXT_PUBLIC_VOLATO_DSN` for routing and
`VOLATO_INGEST_TOKEN` for authorization. Do not add another credential or send
with the DSN alone. Emit only after the durable business transition commits.
Await the delivery promise or register it with the runtime's supported
lifetime hook; never detach it with `void`.

Run focused tests and a production build. Exercise at least one real path and
verify the request reaches `/api/skill-events` with `X-Volato-DSN` and the
server bearer without printing either value.

## Interpret the report

Run `volato analytics report` and read actors before rates. Every percentage and
delay in the report is derived from individual timelines at read time; the
timelines are the evidence and a ratio is only a summary of them.

1. **Observability** — active config, which probes have ever fired, delivery
   failures and any break in comparability.
2. **Who is stuck where, and since when** — for each actor, the furthest
   milestone reached and how long they have been sitting there. Name the step
   where actors accumulate and quote how long they have waited.
3. **Whether the wait means anything** — an actor stopped in front of a
   mandatory gate is blocked; an actor who has had no fresh opportunity since
   receiving value is not. Answer the opportunity and cadence questions from the
   approved proposal before calling any gap a drop-off.
4. **Rates** — conversion between milestones, time to first value and return to
   a delivered outcome, but only once at least twenty actors have entered the
   step being measured. Below that, give the counts and the timelines and refuse
   the percentage; three actors out of five is not sixty percent of anything.
5. **Change** — the difference from a comparable config or prior snapshot.
6. **Decision** — the single milestone blocking the most actors, and the
   smallest next action or probe.

Exclude actors who have not yet had time to reach a step from that step's
denominator. Treat a config, event-definition or tracking change as a
comparability break and do not read across it. Small samples are directional,
not proof: a rate that moves because one actor moved is one actor, not a trend.

AARRR is an optional growth reading, not the event schema. Add acquisition,
referral or revenue only when attribution, invitation and billing sources exist
and the user asks that question. North Star inputs such as breadth, depth,
frequency and efficiency may help interpret a stable product, but do not invent
them from missing data.

## Save an approved snapshot

Draft `.volato/analytics-snapshot.json` from the current report with a concise
summary, observations, caveats and next decision. Do not assign a PMF score or
status. Show the draft to the founder and run
`volato analytics snapshot save` only after explicit approval. Never save an
interpretation automatically.

## Completion criteria

Return:

1. the goal, actor, job and outcome, plus the opportunity and cadence answers
   used to interpret them;
2. the inspection result: mandatory gates, durable transitions and non-web
   entry points found, and which of them became milestones;
3. the event map with keep, add and remove decisions;
4. approved `.volato/analytics.json` and instrumentation changes;
5. validation, sync, tests, build and exercised-path results;
6. where actors currently stand and for how long, with rates only where the
   actor count supports them;
7. data-quality, privacy, maturity and comparability limits;
8. the proposed snapshot, approval state and save result;
9. one next product decision and the smallest measurement change it requires.
