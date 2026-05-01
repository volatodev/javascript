"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";

export type VolatoBootstrapProps = {
  dsn: string;
  environment?: string;
  release?: string;
  debug?: boolean;
};

export function VolatoBootstrap(_props: VolatoBootstrapProps): null {
  // TODO(phase 2): wire up window error / unhandledrejection listeners and
  // POST events to dsnToIngestUrl(dsn). Stub for scaffolding.
  return null;
}

export type VolatoErrorBoundaryProps = {
  children: ReactNode;
  fallback?: ReactNode;
};

type VolatoErrorBoundaryState = {
  hasError: boolean;
};

export class VolatoErrorBoundary extends Component<
  VolatoErrorBoundaryProps,
  VolatoErrorBoundaryState
> {
  state: VolatoErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): VolatoErrorBoundaryState {
    return { hasError: true };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    captureClientError(error, { componentStack: info.componentStack ?? undefined });
  }

  override render(): ReactNode {
    if (this.state.hasError) {
      return this.props.fallback ?? null;
    }
    return this.props.children;
  }
}

export type CaptureClientErrorContext = {
  componentStack?: string;
  tags?: Record<string, string>;
  extra?: Record<string, unknown>;
};

export function captureClientError(
  _error: unknown,
  _context?: CaptureClientErrorContext,
): void {
  // TODO(phase 2): build ErrorEvent payload and POST to ingest endpoint.
}
