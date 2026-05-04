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
};

/**
 * No-op stub for the package skeleton. Returns the config as-is. Real
 * `next.config` integration (instrumentation hook injection, edge wrapping)
 * lands in a future ticket.
 */
export function withVolato<T = VolatoConfig>(config: T): T {
  return config;
}
