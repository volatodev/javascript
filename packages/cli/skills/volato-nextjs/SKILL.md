---
name: volato-nextjs
description: Generate, adapt, and verify the dependency-free Volato integration for a JavaScript or TypeScript Next.js 15/16 App Router, Pages Router, or hybrid application. Use when volato-setup detects Next.js, when generated Next.js capture files need repair or update, or when browser, RSC, SSR, server action, route handler, API Route, middleware, build identity, or sourcemap capture must be checked.
---

# Set up Volato for Next.js

Use the CLI recipe as the source of generated code. Apply repository-specific
judgment only to hook that code into an existing application.

## Workflow

1. Confirm Next.js 15/16 and an App Router root at `app/` or `src/app/`, a
   Pages Router root at `pages/` or `src/pages/`, or both.
   Preserve the repository language: generate `.js`/`.jsx` into JavaScript
   applications and `.ts`/`.tsx` into TypeScript applications.
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

Next.js 16 keeps Turbopack as its default bundler. The recipe uses
`compiler.runAfterProductionCompile` for server maps and appends the generated
dependency-free `postbuild.cjs` after a conventional `next build` command for
the browser maps that Turbopack finalizes later. For a custom build script,
compose `node <generated-runtime>/postbuild.cjs` strictly after the successful
Next.js build; never run it concurrently or replace the selected bundler.

The detector mirrors Next's router precedence: root `app/` or `pages/` wins
over the matching `src/` directory. Next.js 16 hybrid applications must keep
both routers under the same root. The recipe creates `next.config.mjs` when no
config exists, composes ESM/TypeScript config and CommonJS `next.config.js`, and
does not treat unsupported `next.config.cjs` as a framework config.

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
- In a Next.js 16 host `proxy.ts`, compose `wrapProxy` from the generated
  `server` module. Proxy runs in Node; do not route it through the Edge
  middleware adapter.
- Isolate concurrent server request scope.
- Use Next's `onRequestError` hook for leaked RSC errors.
- Use the generated React helper from `app/error.tsx`; do not wrap the root
  layout in a competing error boundary.
- In Pages Router, preserve the custom App's data lifecycle and compose the
  generated bootstrap around its single page render. The generated `_error`
  wrapper delegates the existing component and `getInitialProps`; server
  render, SSR, and API Route errors stay on the awaited `onRequestError` path.
- Preserve existing `instrumentation.register`; append Volato's named handler
  only when the file does not already own or wildcard-export `onRequestError`.
- Treat an existing unwrapped middleware or proxy, an existing App error
  boundary, and a custom Next.js 16 build command as incomplete manual work.
- Upload browser and server sourcemaps during the production build, skip stale
  development artifacts, and remove `sourcesContent` before transit.
- Browser capture sends directly to ingest by default. Add a same-origin tunnel
  only when the application explicitly needs it, then use the generated
  `createTunnelHandler()` with strict DSN, body-size, and timeout controls.

## Completion

The CLI's “files are composed” result is not deployment readiness. Declare the
integration complete only after a synthetic event reaches ingest, the
production build succeeds, and every applicable capture surface used by the
application is exercised. If a surface cannot be composed safely, leave a
precise manual action instead of claiming full coverage.
