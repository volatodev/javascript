---
name: detect-pmf
description: Map a product's core job and outcome into a small event catalog, add dependency-free server-side instrumentation, and assess activation, repeat-use, and retention evidence through Volato. Use when defining an activation funnel, adding outcome-led product analytics, validating product-market-fit signals, or reviewing whether users repeatedly achieve the product's promised outcome.
---

# Detect product-market-fit signals

Measure whether identifiable users repeatedly achieve the product's promised
outcome. Do not substitute page views, clicks, signups, or aggregate traffic for
delivered value.

## Workflow

1. Inspect product and architecture documentation, domain services, database
   transitions, API routes, tests, and the current Volato setup.
2. State one core user job and one observable outcome. Identify the eligible
   cohort, activation transition, repeat-value transition, and retention
   window. Challenge ambiguous or vanity signals before editing code.
3. Build the smallest useful catalog. Prefer 3-8 outcome events. Keep
   `properties` equal to `{}` for every event in schema version 1; actor and
   dedupe identifiers are the only accepted event-specific data. Every event
   must correspond to an authoritative business transition.
4. Read [references/contract.md](references/contract.md), then write the
   versioned catalog to `.volato/pmf.json`. Obtain the project id from the
   user's requested Volato project or the public DSN without printing the DSN.
5. Run `volato pmf validate`. Resolve every local contract error before
   instrumentation or sync.
6. Copy [assets/pmf-tracker.ts](assets/pmf-tracker.ts) into an appropriate
   server-only application module. Never import it from a Client Component.
   Create an `as const` event catalog matching `.volato/pmf.json`, then
   instantiate it with `{ events }`. The tracker reads the two credentials
   already installed by `volato init`: `NEXT_PUBLIC_VOLATO_DSN` for routing and
   `VOLATO_INGEST_TOKEN` for write authorization. Do not add another secret,
   pass credentials as call arguments, or hard-code them. A DSN without the
   server token must not send.
7. Add `void tracker.track(...)` immediately after durable, server-owned
   business transitions commit. Never `await` telemetry on the product response
   path and never emit from inside the business transaction. Never instrument
   UI intent when the backend can observe the delivered outcome. Tracking adds
   no response latency and its delivery result must not roll back, fail, or
   change the committed product transition.
8. Run focused tests and the production build. Exercise at least one real
   instrumented transition and verify its request uses `/api/skill-events`,
   `X-Volato-DSN`, and `Authorization: Bearer <VOLATO_INGEST_TOKEN>` without
   printing either credential.
9. Run `volato pmf sync`, then `volato pmf report`. Interpret immature cohorts
   as insufficient evidence, not failure or success.

## Mapping rules

- `job.statement`: the situation and progress the user hires the product for.
- `job.outcome`: the observable value delivered, written without UI language.
- `cohort.event`: entry into a population that had a fair chance to get value.
- `activation.event`: first meaningful delivery of the promised outcome.
- `repeat.event`: a later delivery of value, at least 24 hours after the first.
- `retention.event`: renewed value after the chosen retention delay.
- `dedupe: actor`: count one occurrence per actor.
- `dedupe: key`: use a stable business entity or transition id.
- `dedupe: none`: count every legitimate occurrence; use sparingly.

Use an opaque, stable internal actor id. Do not send email addresses, names,
free-form user text, stack traces, URLs with query strings, access tokens, or
other credentials. Do not add event properties in schema version 1.

## Completion criteria

Report:

- the job, outcome, cohort, activation, repeat, and retention definitions;
- `.volato/pmf.json` and every instrumentation file changed;
- which authoritative transitions now emit each event;
- local validation, focused test, production build, sync, and report results;
- any missing transition or immature cohort that prevents a trustworthy read.

Do not claim product-market fit from a single event, a synthetic event, or an
immature retention window.
