import { describe, expect, it } from "vitest";
import { isExperimentalProductEnabled } from "../lib/experiments";

describe("Product experiment switch", () => {
  it("is disabled by default and requires the exact internal opt-in", () => {
    expect(isExperimentalProductEnabled({})).toBe(false);
    expect(
      isExperimentalProductEnabled({ VOLATO_EXPERIMENTAL_PRODUCT: "true" }),
    ).toBe(false);
    expect(
      isExperimentalProductEnabled({ VOLATO_EXPERIMENTAL_PRODUCT: "1" }),
    ).toBe(true);
  });
});
