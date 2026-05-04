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
