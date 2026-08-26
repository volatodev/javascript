/**
 * Pages Router's `_error` composition helper. It preserves the application's
 * error UI and `getInitialProps` contract while reporting the actual error on
 * client-side transitions. Server render, SSR, and API Route failures are
 * captured by Next.js's awaited `onRequestError` instrumentation hook.
 */
"use client";

import type { ComponentType } from "react";
import type { NextPageContext } from "next";
import { captureClientError } from "./client";

type PagesErrorComponent<Props extends object> = ComponentType<Props> & {
  getInitialProps?: (context: NextPageContext) => Props | Promise<Props>;
};

type StatusError = Error & { statusCode?: number };

function defaultErrorProps(context: NextPageContext): { statusCode: number } {
  return {
    statusCode:
      context.res?.statusCode ??
      (context.err as StatusError | undefined)?.statusCode ??
      404,
  };
}

export function withVolatoPagesError<Props extends object>(
  ErrorComponent: PagesErrorComponent<Props>,
): PagesErrorComponent<Props> {
  function VolatoPagesError(props: Props) {
    return <ErrorComponent {...props} />;
  }

  VolatoPagesError.displayName = `withVolatoPagesError(${
    ErrorComponent.displayName ?? ErrorComponent.name ?? "Error"
  })`;
  VolatoPagesError.getInitialProps = async (context: NextPageContext) => {
    if (context.err && typeof window !== "undefined") {
      captureClientError(context.err, { capturedVia: "error_boundary" });
    }
    if (ErrorComponent.getInitialProps) {
      return await ErrorComponent.getInitialProps.call(ErrorComponent, context);
    }
    return defaultErrorProps(context) as Props;
  };

  return VolatoPagesError;
}
