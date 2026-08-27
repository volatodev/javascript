---
name: volato-vite-svelte
description: Generate, compose, and verify dependency-free Volato Errors browser capture for Vite + Svelte 5. Use when volato-setup detects one client-rendered Svelte 5 mount built by Vite, or when its generated root boundary, global browser, release, or sourcemap path needs repair. Do not use for Svelte 4, SvelteKit, SSR, hydration, or non-Vite builds.
---

# Set up Volato for Vite + Svelte 5

Keep browser capture independent from any backend. The generated wrapper owns
only the boundary around the original root; it must not change application
behaviour or component APIs.

## Workflow

1. Confirm one client-rendered Svelte 5 application, one statically
   identifiable `mount()` call and root import, and one Vite 6, 7, or 8 config
   in TypeScript or JavaScript.
2. Run `volato init --project <id>` when needed, then run `volato errors init`.
3. Inspect `src/volato/VolatoSvelteRoot.svelte`, the browser runtime, root
   import rewrite, Vite config, protected environment values, and the
   `errors-browser-svelte` manifest entry. The original component source must
   remain untouched and no Volato runtime dependency may be added.
4. Confirm the wrapper forwards root props and uses a real
   `<svelte:boundary>` `onerror` lifecycle. Existing exported root APIs or
   boundary fallback/reset behaviour require a refusal unless setup can
   preserve them exactly.
5. Run the real production build and require one Git release, sanitized private
   map upload, no `sourcesContent`, and removal of public maps.
6. Exercise a controlled render or effect failure through the boundary, plus
   one event-handler failure and one unhandled rejection through the
   browser-global path. Each original failure must emit once; boundary events
   use `capturedVia=svelte_boundary`.
7. Resolve the production chunk frame to the exact repository source file and
   line.

## Boundaries

- Event-handler, timer, and later asynchronous errors are browser-global; do
  not claim that the Svelte boundary captures them.
- Never serialize component props, state, arbitrary values, query values, or
  personal payloads.
- Never expose `VOLATO_INGEST_TOKEN` to the browser or upload
  `sourcesContent`.
- Refuse Svelte 4, SvelteKit, SSR, hydration, custom elements, multiple or
  dynamic roots, exported root APIs, and existing boundaries whose
  fallback/reset behaviour cannot be preserved.

## Completion

Vite + Svelte 5 is ready only after a clean rerun, a real production build,
boundary and browser-global capture checks, privacy checks, and exact source
resolution all pass.
