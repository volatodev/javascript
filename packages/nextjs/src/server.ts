import type { VolatoConfig } from "./index.js";

export function withVolato<T extends Record<string, unknown>>(
  nextConfig: T,
  _volatoConfig?: Partial<VolatoConfig>,
): T {
  // TODO(phase 2): inject instrumentation hook + register edge/node runtime
  // wrappers. Stub for scaffolding — returns nextConfig unchanged.
  return nextConfig;
}

export type CaptureServerErrorContext = {
  request?: {
    url?: string;
    method?: string;
    headers?: Record<string, string>;
  };
  tags?: Record<string, string>;
  extra?: Record<string, unknown>;
};

export function captureServerError(
  _error: unknown,
  _context?: CaptureServerErrorContext,
): void {
  // TODO(phase 2): build ErrorEvent payload and POST to ingest endpoint.
}
