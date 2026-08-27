// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { __resetVolatoBrowserForTests, initVolatoBrowser } from "../browser";
import { captureVolatoSvelteError } from "../svelte";

afterEach(() => {
  __resetVolatoBrowserForTests();
  vi.unstubAllGlobals();
});

describe("private Svelte capture recipe", () => {
  it("captures a boundary failure without invoking or retaining reset", async () => {
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
    const reset = vi.fn();

    captureVolatoSvelteError(new Error("Svelte render failed"), reset);

    expect(reset).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(bodies).toHaveLength(1));
    expect(JSON.parse(bodies[0]!)).toMatchObject({
      message: "Svelte render failed",
      capturedVia: "svelte_boundary",
    });
  });
});
