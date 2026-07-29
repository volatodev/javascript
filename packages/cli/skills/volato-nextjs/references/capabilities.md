# Next.js App Router conformance

Treat an integration as complete only when all applicable surfaces pass:

| Surface | Required capture |
|---|---|
| Browser | `window.error`, unhandled rejection, React error boundary |
| RSC | Next.js `onRequestError` |
| Server action | thrown error and explicit reported failure |
| Route handler | thrown handler error |
| Middleware | thrown Edge-runtime error |
| Build | automatic commit identity and browser sourcemap upload |

Also verify:

- browser, server and Edge bundles contain only APIs available in their runtime;
- the ingest token is absent from browser output;
- query-string secrets are redacted everywhere;
- capture remains idempotent under React Strict Mode;
- sourcemaps arrive without `sourcesContent`;
- a production stack resolves to a repository-relative source location.
