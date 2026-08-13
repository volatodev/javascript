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
const investigation = readFileSync(
  new URL(
    "../../skills/volato-errors/references/investigation.md",
    import.meta.url,
  ),
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

  it("uses stable release, ranking, and privacy-filtered sample primitives", () => {
    for (const tool of [
      "list_projects",
      "get_error_context",
      "search_error_groups",
      "get_error_samples",
      "list_releases",
      "compare_releases",
    ]) {
      expect(investigation).toContain(tool);
    }
    expect(investigation).toContain(
      "volato errors show --project-id <project-id> --json",
    );
    expect(investigation).toContain(".volato/manifest.json");
    expect(investigation).toContain("whole workspace");
    expect(investigation).toContain("volato releases compare");
    expect(investigation).toContain("--sort growth");
    expect(investigation).toContain("volato errors samples");
    expect(investigation).toContain("bodies, cookies, headers, query values");
    expect(investigation).toContain("ephemeral local `jq`");
    expect(investigation).toContain("do not register a persistent tool");
  });

  it("prefers MCP reads, falls back once to CLI JSON, and keeps mutations out of MCP", () => {
    expect(skill).toMatch(/use the authenticated Volato MCP tools when they are available/);
    expect(skill).toMatch(/otherwise confirm `volato --version` and `volato whoami`/);
    expect(skill).toMatch(/Do not call MCP and CLI for the same evidence/);
    expect(skill).toMatch(/Status mutations remain explicit CLI commands/);
    expect(skill).toMatch(/MCP V1 cannot perform them/);
    expect(investigation).toMatch(/replace—not duplicate—the failed MCP read/);
  });
});
