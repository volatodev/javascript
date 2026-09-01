---
name: volato-nuxt
description: Generate, compose, and verify dependency-free Volato Errors browser, SSR, and Nitro capture for the supported Nuxt 4.5.2 integration. Use only when volato-setup detects the exact Nuxt/Nitro/Vue/Vite tuple, Node 22.23.2 or 24.19.0, SSR with the default Vite builder, and the long-lived node-server preset. Refuse static, client-only, hybrid, edge, serverless, provider, layer, multi-app, dynamic-config, and edited-generated-file shapes before mutation.
---

# Set up Volato for Nuxt/Nitro

Use the CLI recipe as the only source of generated code and keep the public
support boundary exact.

## Workflow

1. Confirm one root Nuxt 4.5.2 application with the exact installed Nitro
   2.13.4, Vue 3.5.42, Vue Router 5.2.0 and Vite 8.2.2 tuple; exact Node
   22.23.2 or 24.19.0; `type: module`; one static `nuxt.config.ts`, `.js` or
   `.mjs`; SSR; the default Vite builder; explicit `node-server`; and the
   conventional `app/app.vue` root.
2. Refuse every static-generation, `ssr:false`, hybrid route-rule, layer,
   multi-app, custom-builder, edge/serverless/provider, Deno/Bun or dynamic
   config shape before mutation. Never fall back to the Vite + Vue SPA skill.
3. Run `volato init --project <id>` when the repository is not linked, then run
   `volato errors init` once.
4. Inspect `volato-nuxt/`, `app/plugins/00.volato-errors.client.*`,
   `server/plugins/00.volato-errors.*`, the wrapped Nuxt config, protected local
   environment file, build script and `errors-nuxt` manifest entry. Confirm no
   Volato runtime package was added and no existing plugin was changed.
5. Run the real production build with one explicit or clean-Git release and a
   server-only ingest token. Require successful upload of client and server
   maps without `sourcesContent`, followed by removal of every `.map` from
   `.output`.
6. Exercise a browser global failure, unhandled rejection, client `vue:error`,
   unexpected client `app:error`, SSR failure, unexpected Nitro route failure
   and startup failure. The same causal Error emits once when hooks overlap.
7. Prove deliberate handled Nuxt page/API errors emit nothing. Verify capture
   never changes status, response, `error.vue`, existing hooks or propagation.
8. Resolve browser, SSR and Nitro frames to the exact repository Vue,
   TypeScript or JavaScript source. Retrieve one context through the CLI or MCP,
   patch and test the local cause, and leave production recovery unresolved.

## Privacy and ownership

- Browser configuration uses only `VITE_VOLATO_*`; never introduce
  `NUXT_PUBLIC_VOLATO_*` and never expose `VOLATO_INGEST_TOKEN` to the client.
- Nuxt owns client Vue/application hooks. Nitro is the sole server/SSR owner;
  do not add a server-side Nuxt application plugin that would duplicate SSR.
- Server context may contain only method, normalized matched route, status and
  an existing request ID from application context or `x-request-id`.
- Never serialize raw paths, URLs, params, queries, bodies, cookies, arbitrary
  headers, Nuxt state/payload, Vue instances/component data, custom exception
  properties or source text.
- Preserve existing Vue/Nuxt/Nitro hooks, plugins, `error.vue`, chunk recovery,
  response semantics and the original causal error.

## Completion

The supported Nuxt integration is ready only after setup converges, the
selected frozen cell builds and captures, privacy and exact client/server
source resolution pass, and production recovery remains unresolved until the
fix is deployed and verified.
