import { describe, expect, it } from "vitest";
import { unwrapCauseChain } from "../internal/linked-errors";

describe("unwrapCauseChain", () => {
  it("returns empty for non-Error inputs", () => {
    expect(unwrapCauseChain("string")).toEqual([]);
    expect(unwrapCauseChain(null)).toEqual([]);
    expect(unwrapCauseChain(undefined)).toEqual([]);
    expect(unwrapCauseChain({ message: "duck" })).toEqual([]);
  });

  it("returns empty for an Error with no cause", () => {
    expect(unwrapCauseChain(new Error("solo"))).toEqual([]);
  });

  it("walks one level of cause", () => {
    const root = new Error("outer", { cause: new TypeError("inner") });
    const chain = unwrapCauseChain(root);
    expect(chain.length).toBe(1);
    expect(chain[0]?.type).toBe("TypeError");
    expect(chain[0]?.message).toBe("inner");
    expect(typeof chain[0]?.stack).toBe("string");
  });

  it("walks deep chains in order outermost-cause-first", () => {
    const a = new Error("a");
    const b = new Error("b", { cause: a });
    const c = new Error("c", { cause: b });
    const d = new Error("d", { cause: c });
    const chain = unwrapCauseChain(d);
    expect(chain.map((e) => e.message)).toEqual(["c", "b", "a"]);
  });

  it("caps at depth 5", () => {
    let cur: Error | undefined;
    for (let i = 0; i < 10; i++) {
      cur = new Error(`e${i}`, cur ? { cause: cur } : undefined);
    }
    const chain = unwrapCauseChain(cur!);
    expect(chain.length).toBe(5);
  });

  it("breaks cycles instead of looping forever", () => {
    const a = new Error("a");
    const b = new Error("b", { cause: a });
    (a as { cause?: unknown }).cause = b; // cycle a -> b -> a
    const chain = unwrapCauseChain(a);
    expect(chain.length).toBeLessThanOrEqual(2);
  });

  it("coerces a non-Error cause to a minimal { type, message }", () => {
    const root = new Error("outer", { cause: "string-cause" });
    expect(unwrapCauseChain(root)).toEqual([
      { type: "Error", message: "string-cause", stack: null },
    ]);
  });

  it("extracts name/message/stack from an Error-shaped duck", () => {
    const root = new Error("outer", {
      cause: { name: "DBError", message: "timeout", stack: "DBError\n at x" },
    });
    const chain = unwrapCauseChain(root);
    expect(chain[0]?.type).toBe("DBError");
    expect(chain[0]?.message).toBe("timeout");
    expect(chain[0]?.stack).toBe("DBError\n at x");
  });
});
