import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const skill = readFileSync(
  new URL("../../skills/volato-errors/SKILL.md", import.meta.url),
  "utf8",
);
const openai = readFileSync(
  new URL("../../skills/volato-errors/agents/openai.yaml", import.meta.url),
  "utf8",
);

describe("volato-errors skill contract", () => {
  it("advertises the bounded production-error intentions in discovery metadata", () => {
    for (const intent of [
      "Fix the latest production error",
      "What is broken in production?",
      "What broke after the last deploy?",
      "Investigate this production regression",
      "Users are reporting a crash",
      "Investigate this stack trace",
      "Why is this route failing in production?",
    ]) {
      expect(skill.slice(0, skill.indexOf("---", 4))).toContain(intent);
    }
    expect(skill.slice(0, skill.indexOf("---", 4))).not.toContain(
      "Check production before changing this code",
    );
  });

  it("requires Volato evidence and keeps local verification distinct from resolution", () => {
    expect(skill).toMatch(/Do not invent an\s+error from failing local tests/);
    expect(skill).toContain("A written patch or passing local test alone");
    expect(skill).toMatch(
      /Leave a\s+group unresolved after a merely local patch/,
    );
  });

  it("offers a natural-language UI prompt", () => {
    expect(openai).toContain("$volato-errors");
    expect(openai).toContain("latest production error");
  });
});
