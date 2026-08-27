// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  __resetVolatoBrowserForTests,
  initVolatoBrowser,
} from "../browser";
import { VolatoErrorBoundary } from "../react";

afterEach(() => {
  __resetVolatoBrowserForTests();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

describe("React render adapter", () => {
  it("captures a render failure, preserves fallback behavior, and resets explicitly", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const bodies: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        bodies.push(String(init.body));
        return new Response(null, { status: 202 });
      }),
    );
    initVolatoBrowser({
      dsn: "https://public@api.volato.dev/project",
      environment: "production",
    });
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    function Boom(): React.ReactNode {
      throw new Error("render failure");
    }

    await act(async () => {
      root.render(
        <VolatoErrorBoundary fallback={<p>existing fallback</p>} resetKey={0}>
          <Boom />
        </VolatoErrorBoundary>,
      );
    });
    await vi.waitFor(() => expect(bodies).toHaveLength(1));
    expect(container.textContent).toBe("existing fallback");
    expect(JSON.parse(bodies[0]!).capturedVia).toBe("error_boundary");

    await act(async () => {
      root.render(
        <VolatoErrorBoundary fallback={<p>existing fallback</p>} resetKey={1}>
          <p>recovered view</p>
        </VolatoErrorBoundary>,
      );
    });
    expect(container.textContent).toBe("recovered view");
  });
});
