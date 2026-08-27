import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const skill = readFileSync(
  new URL("../../skills/volato-setup/SKILL.md", import.meta.url),
  "utf8",
);

describe("volato-setup skill contract", () => {
  it("hands verified setup to the agent read path without inventing a dashboard", () => {
    expect(skill).toMatch(
      /ask your\s+coding agent to investigate the latest production error/,
    );
    expect(skill).toContain("CLI or MCP");
    expect(skill).not.toMatch(/dashboard/i);
  });
});
