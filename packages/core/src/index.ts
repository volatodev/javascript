/**
 * `@volatodev/core` — the only package the Volato SDK and the
 * Volato platform both depend on. Owns the wire format (zod
 * schemas + types), the DSN parser, and the path projection
 * contract used to look up sourcemaps.
 *
 * Anything that needs to be byte-identical on both ends of the
 * `SDK → ingest → resolver` pipe lives here. Anything
 * runtime-specific (transport, scope, hub, breadcrumbs) lives
 * in the per-runtime SDK packages.
 */
export * from "./wire.js";
export * from "./dsn.js";
export * from "./source-map-key.js";
