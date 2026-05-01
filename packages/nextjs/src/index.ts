export type { ErrorEvent, Runtime, StackFrame, ParsedDSN } from "@volatodev/core";

export type VolatoConfig = {
  dsn: string;
  environment?: string;
  release?: string;
  debug?: boolean;
};

export { VolatoBootstrap, VolatoErrorBoundary, captureClientError } from "./client.js";
export { withVolato, captureServerError } from "./server.js";
