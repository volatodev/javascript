import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetBeforeSendWarningForTests,
  runBeforeSend,
} from "../internal/before-send";

beforeEach(() => __resetBeforeSendWarningForTests());

describe("runBeforeSend", () => {
  it("returns the event unchanged when no hook is set", () => {
    const ev = { type: "Error", message: "boom" };
    expect(runBeforeSend(undefined, ev)).toBe(ev);
  });

  it("uses the value returned by the hook", () => {
    const ev = { type: "Error", message: "boom" };
    const replaced = runBeforeSend((e) => ({ ...e, message: "redacted" }), ev);
    expect(replaced).toEqual({ type: "Error", message: "redacted" });
  });

  it("drops the event when the hook returns null", () => {
    expect(runBeforeSend(() => null, { type: "Error", message: "x" })).toBeNull();
  });

  it("falls back to the original event when the hook returns junk", () => {
    const ev = { type: "Error", message: "x" };
    expect(runBeforeSend(() => 42 as unknown as typeof ev, ev)).toBe(ev);
  });

  describe("error swallowing", () => {
    let warnSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    });

    afterEach(() => {
      warnSpy.mockRestore();
    });

    it("returns the original event when the hook throws", () => {
      const ev = { type: "Error", message: "boom" };
      const result = runBeforeSend(() => {
        throw new Error("buggy hook");
      }, ev);
      expect(result).toBe(ev);
    });

    it("warns at most once across many failed invocations", () => {
      const ev = { type: "Error", message: "boom" };
      for (let i = 0; i < 5; i++) {
        runBeforeSend(() => {
          throw new Error("buggy");
        }, ev);
      }
      expect(warnSpy).toHaveBeenCalledTimes(1);
    });
  });
});
