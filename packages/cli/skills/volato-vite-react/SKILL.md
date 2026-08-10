---
name: volato-vite-react
description: Generate, compose, and verify dependency-free Volato Errors browser capture for a Vite + React application. Use when volato-setup detects both Vite and React, when the browser adapter needs repair, or when window errors, unhandled rejections, React render failures, release identity, or Vite sourcemaps must be checked. Do not use for Vue, Svelte, or non-React Vite applications.
---

# Set up Volato for Vite + React

Use the CLI recipe as the source of generated code. Keep browser capture
independent from whatever backend the application uses.

## Workflow

1. Confirm that the selected application root contains Vite, React,
   `vite.config.*`, and `src/main.*`.
2. Run `volato init --project <id>` when the repository is not linked, then
   run `volato errors init`.
3. Inspect the generated `src/volato/` runtime, the React entry composition,
   Vite config, environment values, and manifest entry.
4. Preserve an existing Error Boundary. When setup reports a manual outcome,
   call `captureBrowserError` from the existing boundary rather than replacing
   its fallback or reset behavior.
5. Build the production application. Confirm the generated Vite plugin injects
   one Git release into runtime events and uploads only privacy-cleaned maps.
6. Exercise a controlled window error, unhandled rejection, and render error.
7. Confirm each event has `runtime=browser`, contains no query values or
   arbitrary user payload, and resolves to the repository source.

## Boundaries

- Never infer a Node backend merely because Vite itself runs on Node.
- Never put `VOLATO_INGEST_TOKEN` in browser code or a `VITE_*` variable.
- Never upload `sourcesContent`; the build must sanitize maps before transit.
- Preserve existing Vite plugins and config behavior.
- If the React root or Vite export is ambiguous, give one exact manual action
  and leave setup incomplete.
- Do not claim Vue, Svelte, Angular, or universal Vite support.

## Completion

Declare browser coverage only after the production build passes, a conformance
event reaches ingest, and its minified frame resolves to the real source file.
