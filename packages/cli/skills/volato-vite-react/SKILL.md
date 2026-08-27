---
name: volato-vite-react
description: Generate, compose, and verify dependency-free Volato Errors browser capture for React with Vite, Webpack, or Rspack. Use when volato-setup detects React and one supported build adapter, when browser capture needs repair, or when global errors, unhandled rejections, render failures, release identity, or browser sourcemaps must be checked. Do not use for non-React renderers.
---

# Set up Volato for Browser + React

Use the CLI recipe as the source of generated code. Keep browser capture
independent from whatever backend the application uses.

## Workflow

1. Confirm that the selected application root contains React, `src/main.*`,
   and exactly one supported build configuration: Vite `*.ts|js|mts|mjs`,
   Webpack `*.mjs|cjs`, or Rspack `*.mjs|ts`.
2. Run `volato init --project <id>` when the repository is not linked, then
   run `volato errors init`.
3. Inspect the generated `src/volato/` runtime, the React entry composition,
   selected build config, environment values, and manifest entry.
4. Preserve an existing Error Boundary. When setup reports a manual outcome,
   call `captureBrowserError` from the existing boundary rather than replacing
   its fallback or reset behavior.
5. Build the production application. Confirm the generated build adapter
   injects one Git release, uploads only privacy-cleaned maps, and removes the
   public browser map files after the attempt.
6. Exercise a controlled window error, unhandled rejection, and render error.
7. Confirm each event has `runtime=browser`, contains no query values or
   arbitrary user payload, and resolves to the repository source.

## Boundaries

- Never infer a Node backend merely because a browser build tool runs on Node.
- Never put `VOLATO_INGEST_TOKEN` in browser code or a `VITE_*` variable.
- Never upload `sourcesContent`; the build must sanitize maps before transit.
- Browser capture includes the error type, message and stack, runtime,
  environment, release, a value-free route shape, bounded browser context and
  filtered navigation breadcrumbs. It never reads cookies, request or response
  bodies, arbitrary headers, query values, storage values or arbitrary user
  payloads.
- Preserve existing build plugins, output behavior, and static config shape.
- If the React root or build export is ambiguous, give one exact manual action
  and leave setup incomplete.
- Do not claim Vue, Svelte, Angular, vanilla browser, or arbitrary build-tool
  support.

## Completion

Declare browser coverage only after the production build passes, a conformance
event reaches ingest, and its minified frame resolves to the real source file.
