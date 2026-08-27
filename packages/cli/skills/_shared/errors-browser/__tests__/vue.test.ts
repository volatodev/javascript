// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { __resetVolatoBrowserForTests } from "../browser";
import { installVolatoVue, type VueApplication } from "../vue";

afterEach(() => {
  __resetVolatoBrowserForTests();
  vi.unstubAllGlobals();
});

describe("private Vue capture recipe", () => {
  it("captures through errorHandler and preserves the existing handler", async () => {
    const bodies: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        bodies.push(String(init.body));
        return new Response(null, { status: 202 });
      }),
    );
    const previous = vi.fn();
    const app = {
      config: { errorHandler: previous },
    } as VueApplication;

    installVolatoVue(app, {
      dsn: "https://public@api.volato.dev/project",
      environment: "production",
    });
    const error = new Error("Vue render failed");
    app.config.errorHandler?.(error, null, "render function");

    expect(previous).toHaveBeenCalledWith(error, null, "render function");
    await vi.waitFor(() => expect(bodies).toHaveLength(1));
    expect(JSON.parse(bodies[0]!)).toMatchObject({
      message: "Vue render failed",
      capturedVia: "vue_error_handler",
    });
    expect(bodies[0]).not.toContain("render function");
  });
});
