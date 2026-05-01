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
};

/**
 * No-op stub for the package skeleton. Returns the config as-is. Real
 * `next.config` integration (instrumentation hook injection, edge wrapping)
 * lands in a future ticket.
 */
export function withVolato<T = VolatoConfig>(config: T): T {
  return config;
}
