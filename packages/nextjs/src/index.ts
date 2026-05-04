export type {
  ErrorEvent,
  Runtime,
  ParsedDSN,
} from "@volatodev/core";

export type VolatoConfig = {
  dsn: string;
  projectId?: string;
  /**
   * Explicit environment override. When `"development"` the SDK no-ops (no
   * network traffic). When `"production"` the SDK always ships events, even if
   * `process.env.NODE_ENV === "development"`. Defaults to `process.env.NODE_ENV`
   * when unset, and falls back to `"production"` if no `NODE_ENV` is present.
   */
  environment?: string;
  /**
   * Release identifier — usually a Git SHA or a semver tag. Auto-detected on
   * client + server from `VOLATO_RELEASE` (and `NEXT_PUBLIC_VOLATO_RELEASE`
   * for the browser bundle). Pass explicitly to override or to populate the
   * Edge runtime, where env auto-detection is disabled.
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
   */
  ignoreErrors?: ReadonlyArray<string | RegExp>;
  /**
   * Drop events whose `url`, `filename`, or stack contains any of these
   * patterns. Use to suppress errors raised by browser extensions or
   * untrusted third-party scripts.
   */
  denyUrls?: ReadonlyArray<string | RegExp>;
  /**
   * If set, ONLY keep events whose `url`, `filename`, or stack matches one
   * of these patterns. Used to scope reporting to your own domain when
   * embedded in a larger page.
   */
  allowUrls?: ReadonlyArray<string | RegExp>;
  /**
   * Random sampling: drop a fraction of events. `1.0` keeps everything,
   * `0.0` keeps nothing, `0.25` keeps roughly one in four. Applied after
   * `ignoreErrors` / `denyUrls` / `allowUrls` and before `beforeSend`.
   */
  sampleRate?: number;
  /**
   * Same-origin tunnel route. When set, browser captures POST to this
   * path on the host's own origin instead of going straight to the
   * ingest endpoint — sidesteps adblockers that filter requests to
   * `*.ingest.*` domains. Defaults to `"/monitoring"`. Set `false` to
   * disable and send straight to ingest.
   *
   * The server-side route handler is provided by
   * `createTunnelHandler()` from `@volatodev/nextjs/server`.
   */
  tunnel?: string | false;
};

/**
 * No-op stub for the package skeleton. Returns the config as-is. Real
 * `next.config` integration (instrumentation hook injection, edge wrapping)
 * lands in a future ticket.
 */
export function withVolato<T = VolatoConfig>(config: T): T {
  return config;
}
