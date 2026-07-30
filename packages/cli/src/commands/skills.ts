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
import { CliError, postJson } from "../lib/api-client.js";
import { exitCodeForStatus } from "../lib/exit.js";
import {
  printApiError,
  printSuccess,
  type OutputMode,
} from "../lib/output.js";

const BUNDLED_SKILLS = [
  "volato-setup",
  "volato-nextjs",
  "detect-pmf",
  "landing-page",
] as const;

const CATALOG_SKILLS = [
  "volato-nextjs",
  "detect-pmf",
  "landing-page",
] as const;
export type CatalogSkill = (typeof CATALOG_SKILLS)[number];
export type SkillUsageStage = "started" | "outcome";

export type SkillInstallStatus =
  | "created"
  | "updated"
  | "unchanged"
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

function directoriesMatch(source: string, target: string): boolean {
  if (!existsSync(target)) return false;
  const sourceFiles = listFiles(source);
  const targetFiles = listFiles(target);
  if (sourceFiles.join("\n") !== targetFiles.join("\n")) return false;
  return sourceFiles.every(
    (file) =>
      readFileSync(join(source, file), "utf8") ===
      readFileSync(join(target, file), "utf8"),
  );
}

function copyDirectory(source: string, target: string): void {
  for (const file of listFiles(source)) {
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

  return BUNDLED_SKILLS.map((skill) => {
    const source = join(sourceRoot, skill);
    const target = join(targetRoot, skill);
    const targetExists = existsSync(target);
    if (!existsSync(source)) {
      throw new Error(`Bundled skill is missing: ${source}`);
    }
    if (directoriesMatch(source, target)) {
      return { skill, status: "unchanged", target };
    }
    if (targetExists && !options.force) {
      return { skill, status: "conflict", target };
    }
    if (targetExists) {
      rmSync(target, { recursive: true, force: true });
    }
    copyDirectory(source, target);
    return {
      skill,
      status: targetExists ? "updated" : "created",
      target,
    };
  });
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
          : pc.yellow("conflict");
    process.stdout.write(
      `  ${badge}  ${outcome.skill} ${pc.dim(`→ ${outcome.target}`)}\n`,
    );
  }
}

export async function runSkillUsage(options: {
  skill: string;
  stage: string;
  runId: string;
  json?: boolean;
}): Promise<void> {
  if (!CATALOG_SKILLS.includes(options.skill as CatalogSkill)) {
    throw new CliError(
      `Unknown catalog skill ${JSON.stringify(options.skill)}. Expected: ${CATALOG_SKILLS.join(", ")}.`,
    );
  }
  if (options.stage !== "started" && options.stage !== "outcome") {
    throw new CliError("Skill stage must be started or outcome.");
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/.test(options.runId)) {
    throw new CliError(
      "Skill run id must contain 1-80 letters, digits, dots, underscores, colons or hyphens.",
    );
  }

  const backendSkill =
    options.skill === "volato-nextjs" ? "errors-nextjs" : options.skill;
  const response = await postJson(
    `/v1/skills/${encodeURIComponent(backendSkill)}/usage`,
    {
      stage: options.stage,
      runId: options.runId,
    },
  );
  if (!response.ok) {
    printApiError(response);
    process.exit(exitCodeForStatus(response.status));
    return;
  }
  const mode: OutputMode = options.json ? "json" : "human";
  printSuccess(response, mode);
}
