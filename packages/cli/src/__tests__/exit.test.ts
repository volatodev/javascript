import { describe, expect, it } from "vitest";
import { EXIT, exitCodeForStatus } from "../lib/exit.js";

describe("exitCodeForStatus", () => {
  it("classes auth failures (401, 402)", () => {
    expect(exitCodeForStatus(401)).toBe(EXIT.AUTH);
    expect(exitCodeForStatus(402)).toBe(EXIT.AUTH);
  });

  it("classes not-found (404) and rate-limit (429)", () => {
    expect(exitCodeForStatus(404)).toBe(EXIT.NOT_FOUND);
    expect(exitCodeForStatus(429)).toBe(EXIT.RATE_LIMIT);
  });

  it("falls back to GENERAL for everything else", () => {
    expect(exitCodeForStatus(400)).toBe(EXIT.GENERAL);
    expect(exitCodeForStatus(403)).toBe(EXIT.GENERAL);
    expect(exitCodeForStatus(500)).toBe(EXIT.GENERAL);
  });
});
