"use client";

import { useEffect } from "react";
import { captureFromErrorBoundary } from "@volatodev/nextjs/error-boundary";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    captureFromErrorBoundary(error);
  }, [error]);

  return (
    <main style={{ padding: "2rem", fontFamily: "system-ui, sans-serif" }}>
      <h1>Something went wrong</h1>
      <p>The error has been reported to Volato.</p>
      <button type="button" onClick={() => reset()}>
        Try again
      </button>
    </main>
  );
}
