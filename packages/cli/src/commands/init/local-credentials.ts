import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import pc from "picocolors";
import prompts from "prompts";

/** Protect `.env.local` before either domain writes the shared ingest token. */
export async function ensureGitignoreCoversEnvLocal(
  cwd: string,
  nonInteractive = false,
): Promise<void> {
  const path = join(cwd, ".gitignore");
  const fileExists = existsSync(path);
  const content = fileExists ? readFileSync(path, "utf8") : "";

  if (gitignoreCoversEnvLocal(cwd)) return;

  if (!fileExists) {
    process.stdout.write(
      `${pc.yellow("!")} ${pc.bold("No .gitignore in this project.")}\n` +
        `  Your ${pc.cyan("VOLATO_INGEST_TOKEN")} lives in .env.local — without a .gitignore\n` +
        `  covering it, your first ${pc.cyan("`git add .`")} will commit it. The ingest token has\n` +
        `  write access to your Volato data, so a leak means rotating it.\n\n`,
    );
  } else {
    process.stdout.write(
      `${pc.yellow("!")} ${pc.bold(".env.local")} ${pc.bold("is not yet gitignored in this project.")}\n` +
        `  Your ${pc.cyan("VOLATO_INGEST_TOKEN")} lives there — committing it would expose a\n` +
        `  server-only credential. A leak means rotating the token.\n\n`,
    );
  }

  const response = nonInteractive
    ? { patch: true }
    : await prompts(
        {
          type: "confirm",
          name: "patch",
          message: fileExists
            ? "Add `.env*.local` to .gitignore?"
            : "Create .gitignore with `.env*.local`?",
          initial: true,
        },
        {
          onCancel: () => {
            throw new Error("aborted by user");
          },
        },
      );

  if (!response.patch) {
    process.stdout.write(
      `\n  ${pc.red("✗")} Skipped. Your token will end up in commits unless you handle this yourself.\n\n`,
    );
    return;
  }

  const prefix = content.length && !content.endsWith("\n") ? "\n" : "";
  const block = `${prefix}\n# local env files (Volato CLI)\n.env*.local\n`;
  appendFileSync(path, block, "utf8");
  process.stdout.write(
    `  ${pc.green("✓")} ${fileExists ? "Added" : "Created"} ${pc.cyan(".gitignore")} ${
      fileExists ? "rule for" : "covering"
    } ${pc.cyan(".env*.local")}.\n\n`,
  );
}

function gitignoreCoversEnvLocal(cwd: string): boolean {
  const gitRoot = findGitRoot(cwd);
  let directory = cwd;

  while (true) {
    const path = join(directory, ".gitignore");
    const content = existsSync(path) ? readFileSync(path, "utf8") : "";
    const lines = content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"));
    if (
      lines.some(
        (line) =>
          line === ".env*.local" ||
          line === ".env.local" ||
          line === ".env*",
      )
    ) {
      return true;
    }

    if (!gitRoot || directory === gitRoot) return false;
    directory = dirname(directory);
  }
}

function findGitRoot(cwd: string): string | null {
  let directory = cwd;
  while (true) {
    if (existsSync(join(directory, ".git"))) return directory;
    const parent = dirname(directory);
    if (parent === directory) return null;
    directory = parent;
  }
}
