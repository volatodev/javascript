---
name: volato-sveltekit
description: Install and verify the private SvelteKit 2.70.3 Errors calibration on the exact official adapter-node tuple. Use only when volato-setup detects the frozen Svelte, SvelteKit, adapter-node, Vite-plugin and Vite versions on Node 22.23.2 or 24.19.0. Refuse static, client-only, provider, custom-adapter, prerender, service-worker, remote-function, experimental-rendering and ambiguous-hook shapes before mutation.
---

# Set up the private SvelteKit candidate

Keep this candidate distinct from the public Vite + Svelte SPA target and from
a public SvelteKit support claim. Use the CLI recipe as the only source of
generated code.

## Workflow

1. Confirm one repository-root ESM SvelteKit 2.70.3 application with Svelte
   5.56.10, adapter-node 5.5.7, the Svelte Vite plugin 7.3.0, Vite 8.2.2 and
   exact Node 22.23.2 or 24.19.0. Require one `vite.config.ts` or `.js` using
   the inline `sveltekit({ adapter: adapter() })` form and `vite build`.
2. Refuse version drift, CommonJS, monorepos, legacy `svelte.config.*`, dynamic
   config, adapter options, other adapters, custom roots/output, `ssr:false`,
   prerender, service workers, remote functions and experimental rendering
   handling before mutation. Never fall back to `volato-vite-svelte`.
3. Run `volato init --project <id>` when the repository is not linked, then run
   `volato errors init` once.
4. Inspect `volato-sveltekit/`, `src/hooks.client.*`, `src/hooks.server.*`, the
   wrapped Vite config, protected local environment file, build command and
   `errors-sveltekit` manifest entry. Confirm no runtime package was added.
5. Verify that an existing direct named or expression-style `handleError`
   still receives the original receiver and argument once and exposes its exact
   return value or Promise. Every other hook export must remain unchanged.
6. Run the real production build through adapter-node with one explicit or clean-Git
   release and a server-only ingest token. Require upload of privacy-cleaned
   client, final server and intermediate server maps, then require removal of
   every map from `build` and `.svelte-kit/output`.
7. Exercise browser global and unhandled-rejection failures, an unexpected
   client load/navigation failure, and unexpected SSR render, server load,
   action and endpoint failures. Uncontained post-mount render errors belong to
   browser-global capture under the stable framework mode.
8. Prove expected framework `error(...)`, `fail(...)`, validation and ordinary
   responses emit nothing. Preserve their status, response, error page and the
   application hook result.
9. Resolve a browser frame directly and a server frame through exactly one
   `.svelte-kit/output/server` map hop to the exact repository source in
   `.svelte`, TypeScript or JavaScript. Retrieve one context through CLI or MCP,
   patch and test locally, and leave production recovery unresolved.

## Privacy and ownership

- Client hook arguments are never serialized. Browser capture retains only the
  existing depth-redacted route and browser allowlist.
- Server capture may retain only method, bounded `event.route.id`, framework
  status and an existing `x-request-id`.
- Never serialize URLs, raw paths, params, queries, bodies, form/action input,
  validation data, cookies, authorization, arbitrary headers, `locals`,
  request/event objects, component props/state, custom exception properties or
  the returned safe application error.
- SvelteKit `handleError` owns unexpected load, navigation, render, action and
  endpoint failures. Browser globals own only failures outside that handled
  lifecycle. Do not add generic `handle` wrapping or Node fatal handlers.
- Preserve application hooks, error pages, response semantics, status and the
  original Error. Capture failure must not make `handleError` throw, while an
  application hook throw must remain visible.

## Completion

The private candidate is locally ready only after setup converges, all four
frozen cells build and capture, privacy and exact chained source resolution
pass, and packed setup/recovery canaries leave production unresolved. Package
publication, Platform deployment and first external recovery remain unverified
until separately authorized.

Service workers, remote functions and prerender remain explicit refusals.
