"use client";

import { captureClientError } from "../volato/client";

export default function HomePage() {
  return (
    <main style={{ padding: "2rem", fontFamily: "system-ui, sans-serif" }}>
      <h1>Volato — Next.js App Router example</h1>
      <p>Click the button to send a test error to Volato.</p>
      <button
        type="button"
        onClick={() => {
          captureClientError(new Error("Hello from the Volato example app"));
        }}
      >
        Send test error
      </button>
    </main>
  );
}
