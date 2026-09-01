---
name: volato-setup
description: Connect a repository to Volato, inspect its project link, and select an Errors integration skill. Use when an agent is asked to initialize Volato, when volato-errors delegates missing capture setup, or when a generated integration must be repaired or verified.
---

# Set up Volato

Keep each integration inside the developer's repository and prove its complete
data path. Do not invent capture code from scratch.

## Workflow

1. Inspect `package.json` or the language manifest, framework configuration,
   source layout, build scripts and existing `.volato/manifest.json`.
2. Run `volato init --project <id>` from the application root. This links the
   repository and installs the bundled skills; it must not modify application
   source or write runtime credentials.
3. Select every applicable integration independently:
   - Next.js: follow `volato-nextjs`.
   - React browser capture with Vite, Webpack, or Rspack: follow
     `volato-vite-react`.
   - Vue 3 browser capture with Vite: follow `volato-vite-vue`.
   - Svelte 5 browser capture with Vite: follow `volato-vite-svelte`.
   - Angular 20/21/22 client-rendered applications on the official application
     builder: follow `volato-angular`.
   - Generic long-lived Node servers/jobs/scripts, Express, or a
     provider-neutral asynchronous `handler.{ts,js}` invocation: follow
     `volato-node`.
   - Standalone Fastify 5: follow `volato-fastify`.
   - NestJS 11/12 HTTP over Express 5 or Fastify 5: follow `volato-nestjs`.
   - Private FastAPI 0.141 HTTP calibration on maintained Python 3.10-3.14:
     follow `volato-fastapi` and retain its private/publication boundary.
   - Private Nuxt 4.5.2 SSR calibration on the exact Vite + Nitro node-server
     tuple: follow `volato-nuxt`, retain its private/publication boundary, and
     never fall back to the Vite + Vue SPA skill after a Nuxt refusal.
   - Private SvelteKit 2.70.3 full-stack calibration on the exact official
     adapter-node tuple: follow `volato-sveltekit`, retain its private/publication
     boundary, and never fall back to the Vite + Svelte SPA skill after a
     SvelteKit refusal.
   - Private Astro 7.2.9 on-demand calibration on the exact official standalone
     Node adapter tuple: follow `volato-astro`, retain its private/publication
     boundary, and never fall back to a generic Vite renderer skill after an
     Astro refusal.

   Inspect a repository's frontend and backend independently; one repository
   may need one browser renderer skill plus one Node HTTP skill. NestJS owns
   HTTP capture above its transport, so never select standalone Express or
   Fastify HTTP capture for the same Nest application. Run `volato errors init`
   once to generate all selected adapters. Stop with a clear unsupported or
   partial-coverage result when no adapter applies.
4. Review every file change reported by the selected integration before
   continuing. If setup reports a `manual` outcome, complete that exact action
   and rerun `volato errors init`. Do not continue to verification or declare
   readiness until the rerun exits successfully with no manual outcome.
5. Inspect deployment config and public application/auth URL variables. When
   the browser-facing production origins are unambiguous, replace the project
   allowlist with `volato projects origins set <id> <origin...>`. Do not add API
   or ingest origins unless the browser application is actually served there.
   If deployment identity is ambiguous, leave the current policy unchanged and
   report the single missing decision instead of guessing.
6. Confirm that no Volato runtime dependency was added.
7. Build the application and run the framework skill's conformance checks.
8. Verify the selected integration's delivery path. Use only commands exposed
   by `volato --help` and the generated CLI reference. There is no
   `volato errors verify` command: after a controlled event, retrieve the
   bounded proof with `volato errors show --json` or the equivalent read-only
   MCP tool.
9. For Errors, verify a production sourcemap when build credentials are
   available.
10. Report the generated files, configured browser origins, any manual
   integration points, and every check
   that could not be completed.
11. After verified Errors setup, return control to `volato-errors` when setup
    was delegated from an investigation. Otherwise finish with: `Volato Errors
    is ready. Deploy these changes; when a production error arrives, ask your
    coding agent to investigate the latest production error through the Volato
    CLI or MCP.`

Read [references/protocol.md](references/protocol.md) before changing
transport, credentials, event fields, privacy filtering or sourcemap upload.

## Guardrails

- Treat `.volato/manifest.json` as the project link and generated-file
  ownership record. Each integration owns only its own manifest entry.
- Never overwrite a generated file whose hash differs from the manifest.
- Never expose `VOLATO_INGEST_TOKEN` to browser code.
- Never upload source text.
- Treat allowed origins as browser DSN misuse reduction, not authentication.
- Never declare success from file generation alone; compile and exercise the
  capture path.
- Keep unsupported capture surfaces explicit. Partial silent coverage violates
  the Volato contract.
