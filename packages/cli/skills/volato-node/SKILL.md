---
name: volato-node
description: Generate, compose, and verify dependency-free Volato Errors capture for a deployed Node.js runtime, including long-lived servers/jobs/scripts, Express, and provider-neutral asynchronous invocation handlers. Use when volato-setup detects one of those Node lifecycles, when process or invocation capture needs repair, or when Node release identity and sourcemaps must be checked. Do not claim an unproved HTTP framework, provider preset, callback, synchronous, or streaming lifecycle.
---

# Set up Volato for Node.js

Treat Node as a runtime independent from a browser frontend. Distinguish a
long-lived process from an invocation that must finish capture before returning
to its caller. Express is one explicit long-lived HTTP adapter; standalone
Fastify and NestJS HTTP use their dedicated skills.

## Workflow

1. Classify every deployed Node target before setup. The supported long-lived
   matrix is Node 22.23.2/24.19.0, TypeScript/JavaScript,
   package-declared ESM/CommonJS, and one conventional `server`/`job`/`script`
   entry. The invocation matrix uses the same Node/language/module versions and
   exactly one root or `src/handler.{ts,js}` exporting a promise-returning
   asynchronous generic handler or asynchronous Node HTTP `(req, res)`
   handler. Multiple conventional entries require an explicit application
   root/entry. Do not treat frontend tooling as proof of a server runtime.
2. Run `volato init --project <id>` when needed, then `volato errors init`.
3. Inspect each applicable generated root: `volato-node/` for a long-lived
   process and `volato-invocation/` for an invocation. Verify its entry or
   handler composition, build script, protected environment values, and own
   manifest entry.
4. If Express is present, keep `volatoExpressErrorHandler()` after routes and
   before the application's existing error middleware. Preserve the existing
   response and always pass the original error to `next`.
5. If standalone Fastify 5 is present, stop and follow `volato-fastify`. If
   NestJS 11/12 HTTP is present, stop and follow `volato-nestjs`; Nest owns HTTP
   capture above its transport. For any other HTTP framework, report precise
   partial coverage and do not present generic process capture as HTTP support.
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
9. For an invocation, verify that `withVolatoInvocation` wraps the original
   export exactly once, preserves its arguments, `this`, early return value and
   thrown/rejected value, installs no global fatal hook, and flushes within at
   most 2 seconds before rethrowing. Exercise a cold call, sequential warm
   reuse, and concurrent warm reuse; successful calls must emit nothing.
10. For a Node HTTP invocation, verify only method, path depth
    (`/:segment/...`), error status and an existing request id are emitted.
    Generic handlers must not be inspected as HTTP. Callback, synchronous and
    streaming completion are refused before mutation; report that precise
    unsupported shape instead of hand-writing a wrapper.

## Privacy and lifecycle rules

- Never collect request bodies, cookies, authorization headers, arbitrary
  headers, raw query values, or arbitrary parameters.
- Keep `VOLATO_INGEST_TOKEN` server-only.
- Never upload `sourcesContent`.
- Server sourcemaps may remain beside a private Node deployment artifact after
  sanitization; public browser maps are the files that must be removed. Do not
  require deletion of a private `dist/server*.map` as a Node readiness check.
- Do not attach a competing fatal handler when the application already owns
  one; require the explicit, rerunnable composition above.
- Never keep a fatally broken process alive for telemetry.
- Do not claim Express context for Node without Express.
- Do not read provider-specific runtime environment names or imply a provider
  preset. The shipped invocation recipe is provider-neutral; provider presets
  remain unselected until their own lifecycle conformance exists.

## Completion

Declare only the selected Node lifecycle ready. Long-lived coverage requires
the production build, server/manual/fatal capture, non-zero fatal exit,
privacy, map upload and source resolution. Invocation coverage requires the
production build, success/throw/rejection semantics, cold/warm/concurrent
reuse, bounded flush, privacy, map upload and exact source resolution.
