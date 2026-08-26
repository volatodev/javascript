# Next.js router conformance

Treat an integration as complete only when all applicable surfaces pass:

The generated runtime must match the host repository language. Both JavaScript
(`.js`/`.jsx`) and TypeScript (`.ts`/`.tsx`) are conformance-tested without a
runtime package dependency; JavaScript setup must not add TypeScript tooling.

| Surface            | Required capture                                              |
| ------------------ | ------------------------------------------------------------- |
| Browser            | `window.error`, unhandled rejection, React error boundary     |
| RSC                | Next.js `onRequestError`                                      |
| Pages render / SSR | `onRequestError` as `pages_render`                            |
| Pages API Route    | `onRequestError` as `route_handler`                           |
| Server action      | thrown error and explicit reported failure                    |
| Route handler      | thrown handler error                                          |
| Middleware         | thrown Edge-runtime error                                     |
| Proxy (Next.js 16) | thrown Node-runtime error through `wrapProxy`                 |
| Build              | automatic commit identity and browser/server sourcemap upload |

Also verify:

- browser, server and Edge bundles contain only APIs available in their runtime;
- Pages Router keeps existing `_app` and `_error` behavior, including the
  original `_error.getInitialProps`, while client render failures emit once;
- hybrid applications compose both routers around one generated runtime, with
  one browser and server event per original failure;
- middleware forwards the build-injected `NEXT_PUBLIC_VOLATO_RELEASE` to
  `wrapMiddleware`, so Edge events select the same sourcemaps as other runtimes;
- Next.js 16 remains on its configured bundler and runs the generated browser
  map postbuild only after `next build` completes;
- root and `src/` router layouts select the same instrumentation root as
  Next.js; mixed-root hybrids are rejected on Next.js 16 before mutation;
- ESM, TypeScript, CommonJS and initially absent config files all compose the
  dependency-free build helper without changing standalone vs standard output;
- `getStaticProps` remains a loud build failure, not a claimed production
  capture event;
- the ingest token is absent from browser output;
- query-string secrets are redacted everywhere;
- capture remains idempotent under React Strict Mode;
- stale `.next/dev` maps are not uploaded by a production build;
- sourcemaps arrive without `sourcesContent`;
- browser and server production stacks resolve to repository-relative source
  locations.
