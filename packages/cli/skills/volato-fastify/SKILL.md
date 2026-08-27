---
name: volato-fastify
description: Generate, compose, and verify dependency-free Volato Errors capture for standalone Fastify 5 on long-lived Node.js. Use when volato-setup detects one supported Fastify 5 app/listen topology, or when its Node lifecycle, onError hook, response preservation, release, or sourcemap path needs repair. Do not use for Fastify 4, NestJS, serverless, streaming, or multiple instances.
---

# Set up Volato for Fastify 5

Treat Fastify as the HTTP adapter over the generated long-lived Node recipe.
This skill covers standalone Fastify 5, not a Fastify transport owned by
NestJS.

## Workflow

1. Confirm Node 22.23.2 or 24.19.0, Fastify 5, TypeScript or JavaScript,
   package-declared ESM or CommonJS, and exactly one supported same-file or
   split app/listen bootstrap.
2. Run `volato init --project <id>` when needed, then run
   `volato errors init`.
3. Inspect the generated `volato-node/` runtime, the root `onError` hook before
   `listen`, the build/uploader changes, protected environment values, and the
   `errors-node-fastify` manifest entry. Confirm no runtime dependency was
   added.
4. Preserve the default or existing custom Fastify error handler. The Volato
   hook records and returns; it never calls `reply.send`, replaces the error,
   or changes status, headers, body, or propagation.
5. Run the real production build with private sanitized sourcemaps. Exercise
   synchronous and asynchronous route failures, a lifecycle-hook failure, a
   nested-plugin route, and the application's custom/default response.
6. Exercise manual Node capture and a fatal child-process failure. Require a
   bounded flush and the original non-zero exit.
7. Confirm each HTTP failure emits once with only method, normalized route,
   status, and an existing bounded request id, then resolve it to the exact
   repository source file and line.

## Privacy and refusals

- Never collect a request body, cookies, authorization, arbitrary headers,
  query values, route values, or arbitrary parameters.
- Keep `VOLATO_INGEST_TOKEN` server-only and never upload `sourcesContent`.
- Refuse Fastify 4, NestJS-owned Fastify, HTTP/2-specific behaviour,
  WebSockets, streaming/SSE completion, serverless wrappers, custom servers,
  multiple instances, and ambiguous bootstrap.
- Preserve plugin encapsulation and every existing response/error handler.

## Completion

Fastify 5 is ready only after setup converges, production build/map upload,
route/hook/nested-plugin capture, response preservation, fatal lifecycle,
privacy, deduplication, and exact source resolution pass.
