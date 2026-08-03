---
name: volato-nextjs
description: Generate, adapt, and verify the dependency-free Volato integration for a Next.js 15 or 16 App Router application. Use when volato-setup detects Next.js, when generated Next.js capture files need repair or update, or when browser, RSC, server action, route handler, middleware, build identity, or sourcemap capture must be checked.
---

# Set up Volato for Next.js

Use the CLI recipe as the source of generated code. Apply repository-specific
judgment only to hook that code into an existing application.

## Workflow

1. Confirm Next.js 15+ and an App Router root at `app/` or `src/app/`.
2. Run `volato init --project <id>` if the repository is not connected, then
   run `volato errors init`; do not hand-copy runtime implementations.
3. Inspect changes to the layout, error boundary, instrumentation hook, Next
   config, environment file and `.volato/manifest.json`.
4. Handle pre-existing instrumentation, middleware or unusual config exports
   explicitly. Preserve user behavior and compose the generated hooks.
5. Remove obsolete Volato package dependencies and imports.
6. Detect browser-facing production origins from the repository's deployment
   config and public app/auth URL variables. If the result is unambiguous, run
   `volato projects origins set <id> <origin...>`; otherwise leave the existing
   policy unchanged and report the ambiguity rather than guessing.
7. Run the project build and the CLI verification.
8. Exercise each capture surface used by the application.

Next.js 16 uses Turbopack by default, while the current privacy-stripped
sourcemap uploader uses the webpack compiler hook. The recipe therefore adds
`--webpack` to the production build command on Next.js 16. Do not remove it
until Volato ships a native Turbopack build adapter.

Read [references/capabilities.md](references/capabilities.md) for the automatic
build-identity gate and runtime matrix. The user does not create or publish a
Volato release: `withVolato()` derives the Git commit during the build and uses
it for both runtime events and sourcemap uploads.

## Runtime boundaries

- Keep browser code free of Node built-ins and server-only variables.
- Keep Edge code free of unsupported Node APIs.
- In the host `middleware.ts`, pass both
  `process.env.NEXT_PUBLIC_VOLATO_DSN` and
  `process.env.NEXT_PUBLIC_VOLATO_RELEASE` to `wrapMiddleware`; Next inlines
  them while the generated Edge module remains free of `process.env`.
- Isolate concurrent server request scope.
- Use Next's `onRequestError` hook for leaked RSC errors.
- Use the generated React helper from `app/error.tsx`; do not wrap the root
  layout in a competing error boundary.
- Upload sourcemaps during the production build and remove `sourcesContent`
  before transit.
- Browser capture sends directly to ingest by default. Add a same-origin tunnel
  only when the application explicitly needs it, then use the generated
  `createTunnelHandler()` with strict DSN, body-size, and timeout controls.

## Completion

Declare the integration complete only after a synthetic event reaches ingest
and a production build succeeds. If a project uses a capture surface that the
recipe could not compose safely, leave a precise manual action instead of
claiming full coverage.
