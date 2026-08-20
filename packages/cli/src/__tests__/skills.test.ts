import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import prompts from "prompts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { installSkills, runSkillsInstall } from "../commands/skills";

let cwd: string;
let sourceRoot: string;

function addSkill(name: string, body: string): void {
  const root = join(sourceRoot, name);
  mkdirSync(join(root, "agents"), { recursive: true });
  writeFileSync(join(root, "SKILL.md"), body);
  writeFileSync(join(root, "agents", "openai.yaml"), "interface: {}\n");
}

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), "volato-skills-"));
  sourceRoot = join(cwd, "bundled");
  addSkill("volato-setup", "generic");
  addSkill("volato-errors", "errors");
  addSkill("volato-nextjs", "next");
  addSkill("volato-vite-react", "vite-react");
  addSkill("volato-node", "node");
});

afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
});

describe("installSkills", () => {
  it("installs the generic and detected-framework skill set", () => {
    const outcomes = installSkills({ cwd, sourceRoot });

    expect(outcomes.map(({ skill, status }) => ({ skill, status }))).toEqual([
      { skill: "volato-setup", status: "created" },
      { skill: "volato-errors", status: "created" },
      { skill: "volato-nextjs", status: "created" },
      { skill: "volato-vite-react", status: "created" },
      { skill: "volato-node", status: "created" },
    ]);
    expect(
      readFileSync(
        join(cwd, ".agents", "skills", "volato-nextjs", "SKILL.md"),
        "utf8",
      ),
    ).toBe("next");
  });

  it("is idempotent", () => {
    installSkills({ cwd, sourceRoot });

    expect(
      installSkills({ cwd, sourceRoot }).map((outcome) => outcome.status),
    ).toEqual([
      "unchanged",
      "unchanged",
      "unchanged",
      "unchanged",
      "unchanged",
    ]);
  });

  it("does not overwrite a locally modified skill without force", () => {
    installSkills({ cwd, sourceRoot });
    const installed = join(
      cwd,
      ".agents",
      "skills",
      "volato-setup",
      "SKILL.md",
    );
    writeFileSync(installed, "local edit");

    const outcomes = installSkills({ cwd, sourceRoot });
    expect(outcomes[0]?.status).toBe("conflict");
    expect(readFileSync(installed, "utf8")).toBe("local edit");

    expect(
      installSkills({ cwd, sourceRoot, force: true })[0]?.status,
    ).toBe("updated");
    expect(readFileSync(installed, "utf8")).toBe("generic");
  });

  it.each(["monitor-product-usage", "volato-product"])(
    "removes the retired %s skill only with force",
    (skill) => {
      const retired = join(cwd, ".agents", "skills", skill);
      mkdirSync(retired, { recursive: true });
      writeFileSync(join(retired, "SKILL.md"), "local legacy skill");

      expect(installSkills({ cwd, sourceRoot })[0]).toEqual({
        skill,
        status: "conflict",
        target: retired,
      });
      expect(existsSync(retired)).toBe(true);

      expect(installSkills({ cwd, sourceRoot, force: true })[0]).toEqual({
        skill,
        status: "removed",
        target: retired,
      });
      expect(existsSync(retired)).toBe(false);
    },
  );

  it("offers to update installed skills when bundled files differ", async () => {
    installSkills({ cwd, sourceRoot });
    writeFileSync(
      join(sourceRoot, "volato-setup", "SKILL.md"),
      "updated generic",
    );
    prompts.inject([true]);

    await runSkillsInstall({ cwd, sourceRoot });

    expect(
      readFileSync(
        join(cwd, ".agents", "skills", "volato-setup", "SKILL.md"),
        "utf8",
      ),
    ).toBe("updated generic");
  });

  it("removes files that are no longer part of an updated skill", async () => {
    installSkills({ cwd, sourceRoot });
    rmSync(
      join(sourceRoot, "volato-setup", "agents", "openai.yaml"),
    );
    prompts.inject([true]);

    await runSkillsInstall({ cwd, sourceRoot });

    expect(
      existsSync(
        join(
          cwd,
          ".agents",
          "skills",
          "volato-setup",
          "agents",
          "openai.yaml",
        ),
      ),
    ).toBe(false);
  });

  it("supports a portable target directory", () => {
    installSkills({ cwd, sourceRoot, target: ".claude/skills" });

    expect(
      readFileSync(
        join(cwd, ".claude", "skills", "volato-setup", "SKILL.md"),
        "utf8",
      ),
    ).toBe("generic");
  });
});
