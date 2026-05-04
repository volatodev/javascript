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
});

describe("shouldKeep — denyUrls", () => {
  it("drops when any pattern matches url/filename/stack", () => {
    expect(shouldKeep(baseEvent, { denyUrls: ["chunks/main.js"] })).toBe(false);
    expect(shouldKeep(baseEvent, { denyUrls: [/\/checkout/] })).toBe(false);
  });

  it("keeps when no pattern matches", () => {
    expect(shouldKeep(baseEvent, { denyUrls: ["thirdparty.com"] })).toBe(true);
  });
});

describe("shouldKeep — allowUrls", () => {
  it("keeps only when at least one pattern matches", () => {
    expect(shouldKeep(baseEvent, { allowUrls: ["app.example.com"] })).toBe(
      true,
    );
    expect(shouldKeep(baseEvent, { allowUrls: ["other.example.com"] })).toBe(
      false,
    );
  });

  it("keeps when allowUrls is omitted (no implicit deny)", () => {
    expect(shouldKeep(baseEvent, {})).toBe(true);
  });
});

describe("shouldKeep — sampleRate", () => {
  it("keeps everything at sampleRate=1", () => {
    expect(shouldKeep(baseEvent, { sampleRate: 1 }, () => 0.99)).toBe(true);
  });

  it("drops everything at sampleRate=0", () => {
    expect(shouldKeep(baseEvent, { sampleRate: 0 }, () => 0)).toBe(false);
  });

  it("drops when random >= sampleRate", () => {
    expect(shouldKeep(baseEvent, { sampleRate: 0.25 }, () => 0.5)).toBe(false);
  });

  it("keeps when random < sampleRate", () => {
    expect(shouldKeep(baseEvent, { sampleRate: 0.25 }, () => 0.1)).toBe(true);
  });
});

describe("shouldKeep — composition", () => {
  it("ignoreErrors short-circuits before sampleRate roll", () => {
    let randomCalled = false;
    const rng = () => {
      randomCalled = true;
      return 0;
    };
    expect(
      shouldKeep(
        baseEvent,
        { ignoreErrors: ["boom"], sampleRate: 1 },
        rng,
      ),
    ).toBe(false);
    expect(randomCalled).toBe(false);
  });
});
