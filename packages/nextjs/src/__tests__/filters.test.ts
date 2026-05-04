import { describe, expect, it } from "vitest";
import { shouldKeep } from "../internal/filters";

const baseEvent = {
  type: "TypeError",
  message: "boom",
  url: "https://app.example.com/checkout",
  filename: "https://app.example.com/_next/static/chunks/main.js",
  stack: "TypeError: boom\n    at /chunks/main.js:42:7",
};

describe("shouldKeep — ignoreErrors", () => {
  it("keeps when no patterns are configured", () => {
    expect(shouldKeep(baseEvent, {})).toBe(true);
  });

  it("drops on substring match against type:message surface", () => {
    expect(shouldKeep(baseEvent, { ignoreErrors: ["boom"] })).toBe(false);
    expect(shouldKeep(baseEvent, { ignoreErrors: ["TypeError"] })).toBe(false);
  });

  it("drops on RegExp match", () => {
    expect(shouldKeep(baseEvent, { ignoreErrors: [/^TypeError:/] })).toBe(false);
  });

  it("keeps when no pattern matches", () => {
    expect(shouldKeep(baseEvent, { ignoreErrors: ["whatever"] })).toBe(true);
  });

  it("survives a regex that throws (returns false from .test)", () => {
    const exploding = { test: () => { throw new Error("nope"); } } as unknown as RegExp;
    expect(shouldKeep(baseEvent, { ignoreErrors: [exploding] })).toBe(true);
  });
});
