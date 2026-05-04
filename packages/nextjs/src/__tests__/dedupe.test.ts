import { beforeEach, describe, expect, it } from "vitest";
import {
  __resetDedupeForTests,
  shouldSend,
} from "../internal/dedupe";

beforeEach(() => __resetDedupeForTests());

const evA = (): Record<string, unknown> => ({
  type: "TypeError",
  message: "boom",
  stack: "TypeError: boom\n    at /chunks/main.js:42:7",
});
const evB = (): Record<string, unknown> => ({
  type: "RangeError",
  message: "out of bounds",
  stack: "RangeError\n    at /chunks/x.js:10:1",
});

describe("shouldSend", () => {
  it("first occurrence passes", () => {
    let now = 0;
    expect(shouldSend(evA(), { now: () => now })).toBe(true);
  });

  it("second identical occurrence within TTL is dropped", () => {
    let now = 0;
    expect(shouldSend(evA(), { now: () => now })).toBe(true);
    now = 1_000;
    expect(shouldSend(evA(), { now: () => now })).toBe(false);
  });

  it("after TTL expiry, the same event passes again", () => {
    let now = 0;
    expect(shouldSend(evA(), { ttlMs: 5_000, now: () => now })).toBe(true);
    now = 6_000;
    expect(shouldSend(evA(), { ttlMs: 5_000, now: () => now })).toBe(true);
  });

  it("different events are tracked independently", () => {
    let now = 0;
    expect(shouldSend(evA(), { now: () => now })).toBe(true);
    expect(shouldSend(evB(), { now: () => now })).toBe(true);
    now = 1_000;
    expect(shouldSend(evA(), { now: () => now })).toBe(false);
    expect(shouldSend(evB(), { now: () => now })).toBe(false);
  });

  it("ttlMs=0 disables dedup entirely", () => {
    expect(shouldSend(evA(), { ttlMs: 0 })).toBe(true);
    expect(shouldSend(evA(), { ttlMs: 0 })).toBe(true);
  });

  it("a hot loop continues to suppress beyond the initial window", () => {
    let now = 0;
    expect(shouldSend(evA(), { ttlMs: 1_000, now: () => now })).toBe(true);
    now = 500;
    expect(shouldSend(evA(), { ttlMs: 1_000, now: () => now })).toBe(false);
    now = 800;
    expect(shouldSend(evA(), { ttlMs: 1_000, now: () => now })).toBe(false);
    // The repeated hits each refresh the lastSeen marker, so even at t=1500
    // (0.7s after the previous hit) the event is still suppressed.
    now = 1_500;
    expect(shouldSend(evA(), { ttlMs: 1_000, now: () => now })).toBe(false);
  });

  it("missing stack falls back to type+message-only key", () => {
    let now = 0;
    const noStack: Record<string, unknown> = { type: "Error", message: "x" };
    expect(shouldSend(noStack, { now: () => now })).toBe(true);
    expect(shouldSend(noStack, { now: () => now })).toBe(false);
  });
});
