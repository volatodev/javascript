import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import pc from "picocolors";

const BUNDLED_SKILLS = ["volato-setup", "volato-nextjs"] as const;

export type SkillInstallStatus = "created" | "unchanged" | "conflict";

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
    if (!existsSync(source)) {
      throw new Error(`Bundled skill is missing: ${source}`);
    }
    if (directoriesMatch(source, target)) {
      return { skill, status: "unchanged", target };
    }
    if (existsSync(target) && !options.force) {
      return { skill, status: "conflict", target };
    }
    copyDirectory(source, target);
    return { skill, status: "created", target };
  });
}

export function runSkillsInstall(options: InstallSkillsOptions): void {
  const outcomes = installSkills(options);
  for (const outcome of outcomes) {
    const badge =
      outcome.status === "created"
        ? pc.green("installed")
        : outcome.status === "unchanged"
          ? pc.dim("unchanged")
          : pc.yellow("conflict");
    process.stdout.write(
      `  ${badge}  ${outcome.skill} ${pc.dim(`→ ${outcome.target}`)}\n`,
    );
  }

  if (outcomes.some((outcome) => outcome.status === "conflict")) {
    throw new Error(
      "Existing skill files differ. Review them or rerun with --force.",
    );
  }
}
