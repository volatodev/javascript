import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import pc from "picocolors";
import prompts from "prompts";

const PUBLIC_SKILLS = [
  "volato-setup",
  "volato-errors",
  "volato-nextjs",
  "volato-vite-react",
  "volato-node",
] as const;
const RETIRED_SKILLS = ["monitor-product-usage", "volato-product"] as const;

export type SkillInstallStatus =
  | "created"
  | "updated"
  | "unchanged"
  | "removed"
  | "conflict";

export type SkillInstallOutcome = {
  skill: string;
  status: SkillInstallStatus;
  target: string;
};

export type InstallSkillsOptions = {
  cwd: string;
  target?: string;
  sourceRoot?: string;
  force?: boolean;
  nonInteractive?: boolean;
};

function bundledSkillsRoot(): string {
  return join(__dirname, "..", "skills");
}

function listFiles(root: string, prefix = ""): string[] {
  const current = join(root, prefix);
  return readdirSync(current)
    .flatMap((name) => {
      const relative = join(prefix, name);
      return statSync(join(root, relative)).isDirectory()
        ? listFiles(root, relative)
        : [relative];
    })
    .sort();
}

function listInstallableFiles(root: string): string[] {
  return listFiles(root).filter(
    (file) => !file.split(/[\\/]/).includes("__tests__"),
  );
}

function directoriesMatch(source: string, target: string): boolean {
  if (!existsSync(target)) return false;
  const sourceFiles = listInstallableFiles(source);
  const targetFiles = listFiles(target);
  if (sourceFiles.join("\n") !== targetFiles.join("\n")) return false;
  return sourceFiles.every(
    (file) =>
      readFileSync(join(source, file), "utf8") ===
      readFileSync(join(target, file), "utf8"),
  );
}

function copyDirectory(source: string, target: string): void {
  for (const file of listInstallableFiles(source)) {
    const output = join(target, file);
    mkdirSync(dirname(output), { recursive: true });
    writeFileSync(output, readFileSync(join(source, file)));
  }
}

export function installSkills(
  options: InstallSkillsOptions,
): SkillInstallOutcome[] {
  const sourceRoot = options.sourceRoot ?? bundledSkillsRoot();
  const targetRoot = resolve(
    options.cwd,
    options.target ?? ".agents/skills",
  );

  const outcomes: SkillInstallOutcome[] = [];
  for (const skill of RETIRED_SKILLS) {
    const target = join(targetRoot, skill);
    if (!existsSync(target)) continue;
    if (!options.force) {
      outcomes.push({ skill, status: "conflict", target });
      continue;
    }
    rmSync(target, { recursive: true, force: true });
    outcomes.push({ skill, status: "removed", target });
  }

  for (const skill of PUBLIC_SKILLS) {
    const source = join(sourceRoot, skill);
    const target = join(targetRoot, skill);
    const targetExists = existsSync(target);
    if (!existsSync(source)) {
      throw new Error(`Bundled skill is missing: ${source}`);
    }
    if (directoriesMatch(source, target)) {
      outcomes.push({ skill, status: "unchanged", target });
      continue;
    }
    if (targetExists && !options.force) {
      outcomes.push({ skill, status: "conflict", target });
      continue;
    }
    if (targetExists) {
      rmSync(target, { recursive: true, force: true });
    }
    copyDirectory(source, target);
    outcomes.push({
      skill,
      status: targetExists ? "updated" : "created",
      target,
    });
  }
  return outcomes;
}

export async function runSkillsInstall(
  options: InstallSkillsOptions,
): Promise<void> {
  let outcomes = installSkills(options);
  if (outcomes.some((outcome) => outcome.status === "conflict")) {
    if (options.nonInteractive) {
      throw new Error(
        "Existing skill files differ. Review them or rerun with --force.",
      );
    }
    process.stdout.write(
      `${pc.yellow("Installed Volato skills differ from this CLI. Updating replaces local changes in those skill directories.")}\n`,
    );
    const answer = await prompts({
      type: "confirm",
      name: "update",
      message: "Update skills?",
      initial: true,
    });
    if (!answer.update) {
      throw new Error(
        "Skills were not updated. Review them or rerun with --force.",
      );
    }
    outcomes = installSkills({ ...options, force: true });
  }

  for (const outcome of outcomes) {
    const badge =
      outcome.status === "created"
        ? pc.green("installed")
        : outcome.status === "updated"
          ? pc.green("updated")
        : outcome.status === "unchanged"
          ? pc.dim("unchanged")
          : outcome.status === "removed"
            ? pc.green("removed")
          : pc.yellow("conflict");
    process.stdout.write(
      `  ${badge}  ${outcome.skill} ${pc.dim(`→ ${outcome.target}`)}\n`,
    );
  }
}
