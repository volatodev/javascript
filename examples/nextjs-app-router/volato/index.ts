/**
 * Generated integration configuration. Holds:
 *   - the `VolatoConfig` shape (the same options object every
 *     runtime entry point — `VolatoBootstrap`, `wrapAction`,
 *     `wrapMiddleware` — accepts), and
 *   - local protocol types shared by the generated runtime files.
 *
 * Per-runtime entry points live in their own subpath exports
 * declared in `package.json`:
 *   `/client`           browser capture + auto-instrumentation
 *   `/server`           RSC + route-handler + server-action wrappers
 *   `/middleware`       Edge runtime capture
 *   `/instrumentation`  Next.js `onRequestError` re-export
 *   `/error-boundary`   React `error.tsx` capture helper
 *
 * The root also exports the `withVolato` build helper used in
 * `next.config`. Importing only the *types* is erased by the
 * compiler, but `withVolato` is Node-only — it touches `fs` /
 * `child_process` to upload sourcemaps at build time — so call it
 * from `next.config` (a Node context) and never from client or
 * edge code.
 */
export type {
  ErrorEvent,
  Runtime,
  ParsedDSN,
} from "./protocol";

export type VolatoConfig = {
  dsn: string;
  /**
   * Explicit environment override. When `"development"` capture no-ops (no
   * network traffic). When `"production"` capture always ships events, even if
   * `process.env.NODE_ENV === "development"`. Defaults to `process.env.NODE_ENV`
   * when unset, and falls back to `"production"` if no `NODE_ENV` is present.
   */
  environment?: string;
  /**
   * Advanced build-identity override. `withVolato()` normally derives the Git
   * commit and attaches it automatically, so application setup does not need
   * to configure or publish a release.
   */
  release?: string;
  /**
   * Build distribution identifier — opaque, user-defined. Auto-detected
   * from `VOLATO_DIST` on client + server; pass explicitly for Edge.
   */
  dist?: string;
  /**
   * Synchronous mutation/filter hook called once per event right before it
   * is sent to the ingest endpoint. Return the event (mutated or not) to
   * keep it, or `null` to drop it on the floor. Throwing inside this hook
   * is caught and the event is sent through unchanged — the host app must
   * never crash because of a buggy `beforeSend`.
   *
   * Use it for PII scrubbing, allow/deny lists that need full event access,
   * or test gating ("don't send during e2e runs").
   */
  beforeSend?: (event: Record<string, unknown>) => Record<string, unknown> | null;
  /**
   * Drop events whose `type` or `message` matches any of these patterns.
   * Strings match by substring; RegExp by `.test()`. Cheap pre-filter to
   * silence well-known noise (third-party SDK warnings, browser quirks).
   *
   * (Sampling — random drop of a fraction of events — is a server-side
   * concern: pricing already commits to sampling above the included
   * volume. Drop knobs scoped to URL/origin (allowUrls/denyUrls) belong
   * to dashboard culture; without one, ignoreErrors covers the only
   * legitimate need: silencing noisy third-party messages.)
   */
  ignoreErrors?: ReadonlyArray<string | RegExp>;
  /**
   * Include `x-forwarded-for` in server-side event headers. Disabled by
   * default because IP addresses are personal data and most debugging does not
   * need them.
   */
  captureIp?: boolean;
  /**
   * Optional same-origin tunnel route. When set, browser captures POST to this
   * path on the host's own origin instead of going straight to the
   * ingest endpoint — sidesteps adblockers that filter requests to
   * third-party domains. Disabled by default; direct ingest preserves the
   * browser Origin boundary and avoids exposing a public proxy in the host app.
   *
   * The server-side route handler is provided by
   * `createTunnelHandler()` from the generated server module.
   */
  tunnel?: string | false;
};

export { withVolato, type WithVolatoOptions } from "./withVolato";
