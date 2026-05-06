/**
 * The React render-phase capture helper, exposed under the
 * `@volatodev/nextjs/error-boundary` subpath so a customer's
 * `app/error.tsx` only pulls in the helper itself plus a thin
 * forwarder into `client.tsx`. Splitting it out keeps the
 * client bundle that `app/error.tsx` adds to the per-route
 * chunk tiny — Next.js generates one chunk per error boundary
 * file, so size matters here.
 *
 * The single export is `captureFromErrorBoundary`. The detailed
 * docstring on the function explains the App Router pattern.
 */
"use client";

import { captureClientError } from "./client";

/**
 * Capture an error caught by a Next.js 15 `error.tsx` / `global-error.tsx`
 * file-system boundary. App Router's file-system boundaries are the
 * canonical render-phase capture mechanism — wrapping a custom React
 * boundary around the layout used to be the recommended path but it
 * conflicts with default-server layouts and competes with Next's own
 * error handling.
 *
 *   "use client";
 *   import { useEffect } from "react";
 *   import { captureFromErrorBoundary } from "@volatodev/nextjs/error-boundary";
 *
 *   export default function Error({ error, reset }: {
 *     error: Error & { digest?: string };
 *     reset: () => void;
 *   }) {
 *     useEffect(() => { captureFromErrorBoundary(error); }, [error]);
 *     return <button onClick={reset}>Try again</button>;
 *   }
 */
export function captureFromErrorBoundary(
  error: unknown,
  extra?: { componentStack?: string },
): void {
  captureClientError(error, { ...extra, capturedVia: "error_boundary" });
}
