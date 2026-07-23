---
name: volato-nextjs
description: Generate, adapt, and verify the dependency-free Volato integration for a Next.js 15 App Router application. Use when volato-setup detects Next.js, when generated Next.js capture files need repair or update, or when browser, RSC, server action, route handler, middleware, release, or sourcemap capture must be checked.
---

# Set up Volato for Next.js

Use the CLI recipe as the source of generated code. Apply repository-specific
judgment only to hook that code into an existing application.

## Workflow

1. Confirm Next.js 15+ and an App Router root at `app/` or `src/app/`.
2. Run `volato init`; do not hand-copy runtime implementations.
3. Inspect changes to the layout, instrumentation hook, Next config, tunnel
   route, environment file and `.volato/manifest.json`.
4. Handle pre-existing instrumentation, middleware or unusual config exports
   explicitly. Preserve user behavior and compose the generated hooks.
5. Remove obsolete Volato package dependencies and imports.
6. Run the project build and the CLI verification.
7. Exercise each capture surface used by the application.

Read [references/capabilities.md](references/capabilities.md) for the release
gate and runtime matrix.

## Runtime boundaries

- Keep browser code free of Node built-ins and server-only variables.
- Keep Edge code free of unsupported Node APIs.
- Isolate concurrent server request scope.
- Use Next's `onRequestError` hook for leaked RSC errors.
- Use the generated React helper from `app/error.tsx`; do not wrap the root
  layout in a competing error boundary.
- Upload sourcemaps during the production build and remove `sourcesContent`
  before transit.

## Completion

Declare the integration complete only after a synthetic event reaches ingest
and a production build succeeds. If a project uses a capture surface that the
recipe could not compose safely, leave a precise manual action instead of
claiming full coverage.
