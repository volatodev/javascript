---
name: volato-vite-vue
description: Generate, compose, and verify dependency-free Volato Errors browser capture for Vite + Vue 3. Use when volato-setup detects one client-rendered Vue 3 root built by Vite, or when its global browser, Vue error-handler, release, or sourcemap path needs repair. Do not use for Vue 2, Nuxt, SSR, hydration, or non-Vite builds.
---

# Set up Volato for Vite + Vue 3

Keep browser capture independent from any backend in the repository. Use the
CLI recipe as the only source of generated code.

## Workflow

1. Confirm one client-rendered Vue 3 application, one statically identifiable
   `createApp()` root and `mount()` call, and one Vite 6, 7, or 8 config in
   TypeScript or JavaScript.
2. Run `volato init --project <id>` when the repository is not linked, then run
   `volato errors init`.
3. Inspect `src/volato/`, the entry composition, Vite config, protected local
   environment file, and the `errors-browser-vue` manifest entry. Confirm no
   Volato runtime dependency was added.
4. If the application already has `app.config.errorHandler`, verify Volato
   invokes that exact handler with its original arguments and does not replace
   its application behaviour.
5. Run the real production build. Require one Git release, privacy-cleaned map
   upload from the server-only token, removal of public maps, and no
   `sourcesContent` in transit.
6. Exercise a controlled window error, unhandled rejection, and Vue render or
   lifecycle error. Each original failure must emit once; the Vue event must
   use `runtime=browser` and `capturedVia=vue_error_handler`.
7. Resolve the production chunk frame to the exact repository source file and
   line before declaring readiness.

## Boundaries

- Never serialize a Vue component instance, props, state, arbitrary trace, or
  user-authored object.
- Never put `VOLATO_INGEST_TOKEN` in browser code or a `VITE_*` variable.
- Preserve existing Vite plugins, output behaviour, root mount behaviour, and
  the existing Vue error handler.
- Refuse Vue 2, Nuxt, `createSSRApp()`, SSR, hydration, multiple roots, dynamic
  factories, ambiguous mounts, and handlers that cannot be composed exactly.
- Do not infer or instrument a Node backend merely because Vite runs on Node.

## Completion

Vite + Vue 3 is ready only after setup reruns cleanly, the production build and
all three capture surfaces pass, privacy holds, and the minified Vue failure
resolves to the exact repository source.
