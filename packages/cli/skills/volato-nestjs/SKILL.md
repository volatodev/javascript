---
name: volato-nestjs
description: Generate, compose, and verify dependency-free Volato Errors capture for NestJS 11/12 HTTP on Express 5 or Fastify 5. Use when volato-setup detects one conventional Nest HTTP bootstrap, or when its exception filter, transport response, deduplication, Node lifecycle, release, or sourcemap path needs repair. Do not use for non-HTTP or ambiguous Nest applications.
---

# Set up Volato for NestJS 11/12 HTTP

NestJS owns HTTP capture above Express or Fastify. The generated Node recipe
may own process-fatal capture, but do not install standalone Fastify or Express
HTTP capture into the same Nest application.

## Workflow

1. Confirm NestJS 11 or 12, Node 22.23.2 or 24.19.0, a conventional CommonJS
   TypeScript `src/main.ts` bootstrap, one application, one `app.listen`, and
   either the default Express 5 transport or an explicit Fastify 5 adapter.
2. Run `volato init --project <id>` when needed, then run
   `volato errors init`.
3. Inspect `src/volato-node/`, the generated catch-all filter registration,
   selected transport, build/uploader changes, protected environment values,
   and the `errors-node-nestjs` manifest entry. Confirm no runtime dependency
   was added.
4. Require the filter to capture in a guarded path and always delegate response
   handling to `BaseExceptionFilter` through the selected HTTP adapter. Do not
   install standalone Fastify or Express middleware; one exception must emit
   one Nest event.
5. Run the real production Nest CLI build with private sanitized sourcemaps.
   Exercise controlled controller, guard, pipe, and interceptor exceptions on
   the selected transport.
6. Confirm the exact original default response status/body/headers, plus any
   explicitly supported existing catch-all filter behaviour, remain unchanged.
7. Require only method, normalized route, status, and an existing request id;
   resolve every controlled exception to the exact repository source file and
   line. Also verify manual and fatal Node capture without duplicate HTTP
   events.

## Privacy and refusals

- Never collect request bodies, cookies, authorization, arbitrary headers,
  query values, route values, locals, or personal payloads.
- Keep `VOLATO_INGEST_TOKEN` server-only and never upload `sourcesContent`.
- Refuse GraphQL, WebSockets, gateways, microservices, hybrid applications,
  serverless bootstraps, standalone application contexts, custom adapters,
  multiple applications, JavaScript-source projects, and ambiguous or scoped
  exception filters.
- Never claim Nest coverage from generic Node or transport middleware alone.

## Completion

NestJS 11/12 HTTP is ready only after setup converges, both the selected Nest
and Node lifecycles build, every promised exception surface captures once,
response behaviour and privacy remain exact, and production frames resolve to
the causal source.
