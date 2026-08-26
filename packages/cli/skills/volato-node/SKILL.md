---
name: volato-node
description: Generate, compose, and verify dependency-free Volato Errors capture for a deployed Node.js runtime, with Express as the supported HTTP adapter. Use when volato-setup detects a Node server, worker, job, script, or Express application, when fatal process capture needs repair, or when Node release identity and sourcemaps must be checked. Do not claim HTTP framework context for Fastify, Hono, NestJS, or an unknown server framework.
---

# Set up Volato for Node.js

Treat Node as a runtime independent from a Vite frontend. Use Express only as
the first explicit HTTP adapter.

## Workflow

1. Identify exactly one conventional deployed Node entry and production build
   command. The supported long-lived matrix is Node 22.23.2/24.19.0,
   TypeScript/JavaScript, package-declared ESM/CommonJS, and
   `server`/`job`/`script` entries. Multiple conventional entries require an
   explicit application root/entry. Do not treat frontend tooling as proof of
   a server runtime.
2. Run `volato init --project <id>` when needed, then `volato errors init`.
3. Inspect the generated `volato-node/` runtime, entry import, process handler,
   build script, environment values, and manifest entry.
4. If Express is present, keep `volatoExpressErrorHandler()` after routes and
   before the application's existing error middleware. Preserve the existing
   response and always pass the original error to `next`.
5. If another HTTP framework is present, install only generic Node capture and
   report that framework-specific method, normalized route, status, and request
   id are not covered.
6. Build with sourcemaps, set `VOLATO_RELEASE` to the deployed Git identity,
   and run the generated privacy-cleaned uploader with the server-only token.
   For `tsc`, use its configured `outDir`; if a custom build output cannot be
   identified safely, add the generated uploader as a post-build action for the
   reviewed repository-relative output directory, then rerun
   `volato errors init` and require it to exit successfully.
7. Exercise manual capture, a controlled Express error when applicable, and a
   fatal child-process error. Confirm fatal capture flushes within its bounded
   deadline and the child still exits non-zero.
8. If the selected entry already owns `uncaughtException` or
   `unhandledRejection`, preserve that handler: await `captureNodeException`
   inside it with the matching `capturedVia`, initialize with
   `installFatalHandlers: false`, retain the original cleanup/exit behavior,
   and rerun setup until the manual outcome disappears.

## Privacy and lifecycle rules

- Never collect request bodies, cookies, authorization headers, arbitrary
  headers, raw query values, or arbitrary parameters.
- Keep `VOLATO_INGEST_TOKEN` server-only.
- Never upload `sourcesContent`.
- Do not attach a competing fatal handler when the application already owns
  one; require the explicit, rerunnable composition above.
- Never keep a fatally broken process alive for telemetry.
- Do not claim Express context for Node without Express.

## Completion

Declare Node coverage only after the production build, server capture, fatal
exit behavior, privacy assertions, map upload, and source resolution pass.
