# @volatodev/cli

## 0.1.0-beta.16

### Patch Changes

- 7f634e5: Deduplicate source-map uploads shared by Next.js webpack compilers so a production build sends each map once and stays within the protected ingest budget.

## 0.1.0-beta.15

### Patch Changes

- dbd1587: Retain private Next.js server source maps until standalone output has been assembled while continuing to remove public browser maps after upload.

## 0.1.0-beta.14

### Patch Changes

- 95a8427: Resolve Next.js server stacks with privacy-cleaned source maps, keep temporary
  verification types consistent, scope latest-error investigations to the linked
  project, align headless authentication checks, omit arbitrary thrown-object
  fields, and select safe Node build output directories.

## 0.1.0-beta.13

### Patch Changes

- 43cd14a: Report unsupported backend and HTTP surfaces explicitly while preserving
  independent Vite + React browser coverage.
- 2693b3d: Require a factual audit note when resolving, reopening, or ignoring an error
  group.

## 0.1.0-beta.12

### Patch Changes

- 94c8336: Give cold Next.js verification routes enough time to compile before retrying,
  preventing an accepted first capture from being mistaken for a deduplicated
  ingest rejection on Next.js 15.

## 0.1.0-beta.11

### Patch Changes

- 4b2dea1: Include the captured Next.js development logs when the generated integration
  canary is rejected, so transport status and server reason remain actionable.

## 0.1.0-beta.10

### Minor Changes

- bfa8c9c: Add the `volato-errors` business skill, natural-language investigation handoff,
  and a fresh-agent eval that proves production evidence is queried before a
  locally verified patch while resolution remains explicit.
- 757d850: Add bounded release comparison, richer error-group filters and rankings, and
  privacy-filtered representative event samples for local agent composition.
- e90005a: Add independently detected Vite + React browser and Node.js server adapters,
  with Express HTTP context, privacy-stripped sourcemaps, honest partial support,
  and packed-artifact full-stack conformance.

## 0.1.0-beta.9

### Minor Changes

- f88ec12: Replace declared cohort ratios with actor timelines, report installed Errors
  and Analytics adapters, and require clean-app conformance from the packed and
  published CLI artifacts.

## 0.1.0-beta.8

### Minor Changes

- b03ebd4: Make `volato init` a source-neutral repository connection, move Next.js error
  capture to `volato errors init`, and add `volato analytics init` with an
  independent generated-file manifest entry and typed product tracker.

### Patch Changes

- c6fb842: Confirm authenticated project linking after init and let
  product-analytics branch comparison begin after shared activation
  milestones.

## 0.1.0-beta.7

### Minor Changes

- 5496a8e: Let detect-pmf define strict SaaS-owned enum properties, compare coherent
  outcome branches, and declare catalogs beyond the former 32-event limit while
  remaining bounded by the 32 KiB config contract.

## 0.1.0-beta.6

### Minor Changes

- 112948b: Add the detect-pmf skill and CLI evidence workflow with a privacy-minimal event
  contract, ordered outcome milestones, server-authorized delivery, explicit
  founder-approved assessment history, bounded requests, and failure-safe
  instrumentation.

## 0.1.0-beta.5

### Patch Changes

- Prompt to update differing installed skills, refresh them automatically during
  non-interactive init, and forward the build-injected Git release through the
  generated middleware setup.

## 0.1.0-beta.4

### Patch Changes

- Keep release, environment, and dist reads statically analyzable so Next.js
  inlines the build commit into runtime events and matches uploaded sourcemaps.

## 0.1.0-beta.3

### Minor Changes

- Add an authenticated project command that lets coding agents replace or clear
  the browser-origin allowlist during setup.

### Patch Changes

- bd90b75: Use one automatically detected Git commit for runtime events and sourcemap
  uploads, removing the need for users to configure or publish a Volato release.

## 0.1.0-beta.2

### Minor Changes

- ec0ff56: Add authenticated `volato init --project`, automatic skill installation,
  protected local credential setup, and production-build conformance for
  Next.js 15 and 16.

## 0.1.0-beta.1

### Minor Changes

- feac841: Replace SDK-oriented setup with portable agent skills and deterministic
  framework recipes, including bounded direct event delivery, safe payload
  serialization, and fresh-project artifact conformance.
