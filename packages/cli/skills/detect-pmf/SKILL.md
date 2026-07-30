---
name: detect-pmf
description: Map a product's core job and outcome into a small event catalog, add dependency-free server-side instrumentation, and assess behavioral activation, repeat-use, and retention evidence through Volato. Use when defining an activation funnel, adding outcome-led product analytics, validating product-market-fit signals, or reviewing whether users repeatedly achieve the product's promised outcome.
---

# Detect product-market-fit signals

Measure whether identifiable users repeatedly achieve the product's promised
outcome. Do not substitute page views, clicks, signups, or aggregate traffic for
delivered value. This skill assesses observed product behavior only. Do not
fetch, invent, or merge survey, interview, market, or third-party evidence into
its assessment.

## Workflow

1. Inspect product and architecture documentation, domain services, database
   transitions, API routes, tests, and the current Volato setup.
2. Ask the founder focused questions about what the product does, its target
   actor, the situation that creates the job, the promised outcome, and the
   authoritative transitions that prove progress. Challenge ambiguous or
   vanity signals.
3. Propose the product summary, job, 2-8 ordered milestones, cohort,
   activation, repeat, retention, and the smallest property-free event
   catalog. Do not edit files yet.
4. Obtain explicit founder approval for that proposal.
5. Read [references/contract.md](references/contract.md), write the current
   schema to `.volato/pmf.json`, then run `volato pmf validate`. Do not preserve
   the legacy shape. Obtain the project id from the requested Volato project or
   the public DSN without printing the DSN.
6. Run `volato pmf sync` and require success before adding instrumentation or
   deploying. The backend catalog must exist before any real event can fire.
7. Copy [assets/pmf-tracker.ts](assets/pmf-tracker.ts) into an appropriate
   server-only application module. Never import it from a Client Component.
   Create an `as const` event catalog matching `.volato/pmf.json`, then
   instantiate it with `{ events }`. The tracker reads the two credentials
   already installed by `volato init`: `NEXT_PUBLIC_VOLATO_DSN` for routing and
   `VOLATO_INGEST_TOKEN` for write authorization. Do not add another secret,
   pass credentials as call arguments, or hard-code them. A DSN without the
   server token must not send.
8. Track immediately after durable, server-owned business transitions commit.
   Never emit from inside the business transaction or instrument UI intent when
   the backend can observe delivered value. Do not discard the returned promise
   with `void`: await it after the commit, or register it with the runtime's
   request-lifetime hook (`waitUntil`, `after`, or equivalent). The promise
   resolves to a delivery boolean and the tracker emits an actionable warning
   on failure. Preserve capture-or-scream without rolling back the committed
   product transition.
9. Run focused tests and the production build. Exercise at least one real
   instrumented transition and verify its request uses `/api/skill-events`,
   `X-Volato-DSN`, and `Authorization: Bearer <VOLATO_INGEST_TOKEN>` without
   printing either credential.
10. Run `volato pmf report` after the real path. Interpret immature cohorts as
    insufficient evidence, not failure or success.
11. Propose a behavioral assessment in `.volato/pmf-assessment.json`, grounded
    only in that report. Show status, summary, observations, caveats, and next
    decision. Never save automatically.
12. Obtain explicit founder approval, set `approved` to `true`, then run
    `volato pmf assessment save`. If approval is absent or the config version
    changed, stop without saving.

## Mapping rules

- `product.summary`: what the product does.
- `product.targetActor`: who experiences the product's value.
- `job.statement`: the situation and progress the user hires the product for.
- `job.outcome`: the observable value delivered, written without UI language.
- `milestones`: 2-8 ordered behavioral questions; the first event is cohort
  entry and the last event is activation.
- `cohort.event`: entry into a population that had a fair chance to get value.
- `activation.event`: first meaningful delivery of the promised outcome.
- `repeat.event`: a later delivery of value, at least 24 hours after the first.
- `retention.event`: renewed value after the chosen retention delay.
- `dedupe: actor`: count one occurrence per actor.
- `dedupe: key`: use a stable business entity or transition id.
- `dedupe: none`: count every legitimate occurrence; use sparingly.

Use an opaque, stable internal actor id. Do not send email addresses, names,
free-form user text, stack traces, URLs with query strings, access tokens, or
other credentials. Do not add event properties.

## Completion criteria

Report:

- the product, target actor, job, milestones, cohort, activation, repeat, and
  retention definitions;
- `.volato/pmf.json` and every instrumentation file changed;
- which authoritative transitions now emit each event;
- local validation, focused test, production build, sync, and report results;
- the proposed assessment, explicit approval state, and save result;
- any missing transition or immature cohort that prevents a trustworthy read.

Do not claim product-market fit from a single event, a synthetic event, or an
immature retention window. Never turn an unapproved proposal into saved
assessment history.
