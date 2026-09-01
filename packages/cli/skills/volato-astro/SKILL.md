---
name: volato-astro
description: Generate, compose, and verify the supported Astro 7.2.9 Errors integration on the exact official standalone Node adapter tuple. Use only when volato-setup detects the frozen Astro, adapter, Vite and optional single-renderer versions on Node 22.23.2 or 24.19.0. Refuse static, Actions, alternate-adapter, mixed-renderer and non-client:load shapes before mutation.
---

# Set up the supported Astro integration

Keep this on-demand integration distinct from the generic Vite renderer
targets. Use the CLI recipe as the only source of generated code and keep the
support boundary exact.

## Workflow

1. Confirm one repository-root ESM Astro 7.2.9 application with
   `@astrojs/node` 11.1.4, Vite 8.2.2 and exact Node 22.23.2 or 24.19.0.
   Require `astro.config.mjs`, `output: "server"`, one direct
   `node({ mode: "standalone" })`, conventional `src`/`dist` roots and the
   exact `astro build` production build command.
2. Admit zero or one exact renderer: React 19 through `@astrojs/react` 6.0.4,
   Vue 3 through `@astrojs/vue` 7.0.2, or Svelte 5 through
   `@astrojs/svelte` 9.0.1. Refuse mixed renderers, renderer options and every
   hydration directive except `client:load` before mutation.
3. Refuse static output, prerendering, Actions, adapter middleware mode,
   provider/custom adapters, Bun/Deno, monorepos, custom roots/output, dynamic
   configuration and ambiguous build commands. Never fall back to a generic
   Vite skill.
4. Run `volato init --project <id>` when the repository is not linked, then run
   `volato errors init` once.
5. Inspect `volato-astro/`, the wrapped Astro config, protected local
   environment file, build command and `errors-astro` manifest entry. Confirm
   no runtime dependency was added and every pre-existing integration remains
   in its original order.
6. Run the real production build with one explicit or clean-Git release and a
   server-only ingest token. Require privacy-cleaned client and final server map
   uploads, then require deletion of every map under `dist` on success, skipped
   credentials and failure.
7. Exercise authored browser errors and rejections, unexpected `.astro`
   rendering, endpoint and server-island failures, plus the selected renderer's
   SSR and `client:load` path. Require one group per causal Error.
8. Prove Astro Actions, expected framework outcomes, ordinary responses and
   successful streaming emit nothing. Preserve application middleware,
   response headers, custom error pages, status and the exact thrown Error.
9. Resolve browser and server frames directly to the exact repository source
   in `.astro`, `.tsx`, `.jsx`, `.vue`, `.svelte`, TypeScript or JavaScript.
   Retrieve one context through CLI or MCP, patch and test locally, and leave
   production recovery unresolved.

## Privacy and ownership

- Browser capture retains only the existing depth-redacted route and browser
  allowlist. The hydration event's component URL and island props are ignored.
- Server capture may retain only method, bounded normalized matched route,
  status 500 and an existing bounded `x-request-id`.
- Never serialize URL or raw path, params, query, body, form/action input,
  headers other than request ID, cookies, sessions, `Astro.locals`, content
  data, island props, component instances, Vue info or exception properties.
- Integration `pre` middleware owns propagating on-demand server failures.
  Browser globals own authored scripts and React hydration; the exact Astro
  hydration event owns Svelte; the owned Vue app handler owns Vue.
- Capture failure must be loud but cannot replace the application response or
  error. The middleware always rethrows the same Error object.

## Completion

The supported Astro integration is ready only after all sixteen frozen cells
pass the production build, capture, privacy, lifecycle, exact repository
source, packed setup and recovery gates. Production recovery remains
unresolved until a corrected deployment is observed.

Static sites, Actions, alternate adapters, mixed renderers and non-`client:load`
hydration remain explicit refusals.
