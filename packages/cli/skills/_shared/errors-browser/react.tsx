import React, { type ErrorInfo, type ReactNode, useEffect } from "react";
import {
  captureBrowserError,
  initVolatoBrowser,
  type BrowserConfig,
} from "./browser";

export function VolatoBootstrap(props: BrowserConfig = {}): null {
  useEffect(() => initVolatoBrowser(props), [
    props.dsn,
    props.enabled,
    props.environment,
    props.release,
  ]);
  return null;
}

type BoundaryProps = {
  children: ReactNode;
  fallback?: ReactNode;
  resetKey?: unknown;
};
type BoundaryState = { failed: boolean };

export class VolatoErrorBoundary extends React.Component<
  BoundaryProps,
  BoundaryState
> {
  state: BoundaryState = { failed: false };

  static getDerivedStateFromError(): BoundaryState {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    void captureBrowserError(error, {
      componentStack: info.componentStack ?? undefined,
      capturedVia: "error_boundary",
    });
  }

  componentDidUpdate(previous: BoundaryProps): void {
    if (this.state.failed && previous.resetKey !== this.props.resetKey) {
      this.setState({ failed: false });
    }
  }

  render(): ReactNode {
    return this.state.failed ? (this.props.fallback ?? null) : this.props.children;
  }
}

export { captureBrowserError } from "./browser";
