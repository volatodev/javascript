import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { installSkills } from "../commands/skills";

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
  addSkill("volato-nextjs", "next");
});

afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
});

describe("installSkills", () => {
  it("installs the generic and detected-framework skill set", () => {
    const outcomes = installSkills({ cwd, sourceRoot });

    expect(outcomes.map(({ skill, status }) => ({ skill, status }))).toEqual([
      { skill: "volato-setup", status: "created" },
      { skill: "volato-nextjs", status: "created" },
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
    ).toEqual(["unchanged", "unchanged"]);
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
    ).toBe("created");
    expect(readFileSync(installed, "utf8")).toBe("generic");
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
