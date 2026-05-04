"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";
import { captureClientError } from "./client";

type Props = {
  children: ReactNode;
  fallback?: ReactNode;
};

type State = {
  hasError: boolean;
};

/**
 * React error boundary. `window.onerror` and `unhandledrejection` do NOT fire
 * for render-phase errors that React catches — wrap `app/error.tsx` (or the
 * root layout) with this component to forward those to Volato.
 *
 * In Next.js 15 App Router, prefer using `error.tsx` / `global-error.tsx`
 * file-system boundaries (Next manages them automatically) and call
 * `captureFromErrorBoundary` from inside their `useEffect`.
 */
export class VolatoErrorBoundary extends Component<Props, State> {
  override state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    captureClientError(error, {
      componentStack: info.componentStack ?? undefined,
      capturedVia: "error_boundary",
    });
  }

  override render(): ReactNode {
    if (this.state.hasError) {
      return this.props.fallback ?? null;
    }
    return this.props.children;
  }
}

/**
 * Capture an error caught by a Next.js 15 `error.tsx` / `global-error.tsx`
 * file-system boundary. These boundaries are managed by Next directly, so
 * `<VolatoErrorBoundary>` is not involved.
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
