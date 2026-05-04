import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { detectBrowserContext } from "../internal/browser-context";

beforeEach(() => {
  // Tests stub navigator on a per-case basis.
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("detectBrowserContext", () => {
  it("returns undefined when navigator is missing", () => {
    expect(detectBrowserContext()).toBeUndefined();
  });

  it("prefers userAgentData.brands when present", () => {
    vi.stubGlobal("navigator", {
      userAgent: "Mozilla/5.0 ...",
      userAgentData: {
        brands: [
          { brand: "Not_A Brand", version: "8" },
          { brand: "Chromium", version: "131" },
          { brand: "Google Chrome", version: "131" },
        ],
      },
    });
    expect(detectBrowserContext()).toEqual({
      name: "Google Chrome",
      version: "131",
    });
  });

  it("falls back to UA string for Safari", () => {
    vi.stubGlobal("navigator", {
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
    });
    expect(detectBrowserContext()).toEqual({ name: "Safari", version: "17.5" });
  });

  it("detects Firefox from UA string", () => {
    vi.stubGlobal("navigator", {
      userAgent:
        "Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0",
    });
    expect(detectBrowserContext()).toEqual({
      name: "Firefox",
      version: "131.0",
    });
  });

  it("detects Edge before Chrome (Edg/ wins over Chrome/)", () => {
    vi.stubGlobal("navigator", {
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0",
    });
    expect(detectBrowserContext()?.name).toBe("Edge");
  });

  it("returns undefined for an unrecognised UA", () => {
    vi.stubGlobal("navigator", {
      userAgent: "Mozilla/5.0 (Compatible; SomeBot/1.0)",
    });
    expect(detectBrowserContext()).toBeUndefined();
  });
});
