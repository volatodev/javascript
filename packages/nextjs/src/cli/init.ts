/**
 * Orchestrator for `volato init`. Owns the prompt flow, calls the patch
 * primitives, and prints a final report.
 */

import pc from "picocolors";
import prompts from "prompts";
import { detectProject, DetectionError } from "./detect";
import {
  buildMiddlewareSnippet,
  patchEnvLocal,
  patchInstrumentation,
  patchLayout,
  type PatchOutcome,
  type PatchStatus,
} from "./patch";

export type InitOptions = {
  cwd: string;
  /** When set, skip the DSN prompt. */
  dsn?: string;
  /** Disable interactive prompts (e.g. CI). Requires `dsn`. */
  nonInteractive?: boolean;
};

const STATUS_BADGE: Record<PatchStatus, string> = {
  created: pc.green("created"),
  updated: pc.cyan("updated"),
  skipped: pc.dim("skipped"),
  manual: pc.yellow("manual"),
};

function isValidDsn(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

async function promptForDsn(): Promise<string> {
  const response = await prompts(
    {
      type: "text",
      name: "dsn",
      message: "Paste your Volato DSN",
      validate: (v: string) =>
        isValidDsn(v) ||
        "Enter a full https://… URL — see your Volato project settings",
    },
    {
      onCancel: () => {
        throw new Error("aborted by user");
      },
    },
  );
  return response.dsn as string;
}

function relpath(cwd: string, abs: string): string {
  return abs.startsWith(cwd) ? abs.slice(cwd.length).replace(/^\//, "") : abs;
}

function printOutcome(cwd: string, outcome: PatchOutcome): void {
  const badge = STATUS_BADGE[outcome.status];
  const detail = outcome.detail ? pc.dim(` — ${outcome.detail}`) : "";
  process.stdout.write(`  ${badge}  ${relpath(cwd, outcome.path)}${detail}\n`);
}

export async function runInit(options: InitOptions): Promise<void> {
  const { cwd } = options;

  process.stdout.write(`${pc.bold("volato")} init  ${pc.dim(cwd)}\n\n`);

  let project;
  try {
    project = detectProject(cwd);
  } catch (err) {
    if (err instanceof DetectionError) {
      throw new Error(err.message);
    }
    throw err;
  }

  const dsn = options.dsn ?? (await resolveDsn(options));
  if (!isValidDsn(dsn)) {
    throw new Error(`Invalid DSN: ${dsn}`);
  }

  const outcomes: PatchOutcome[] = [];
  outcomes.push(patchEnvLocal(cwd, dsn));
  outcomes.push(
    patchInstrumentation(project.instrumentationPath, project.language),
  );
  outcomes.push(patchLayout(project.layoutPath));

  for (const o of outcomes) printOutcome(cwd, o);
  process.stdout.write("\n");

  printNextSteps(project.middlewarePath, cwd);
}

async function resolveDsn(options: InitOptions): Promise<string> {
  if (options.nonInteractive) {
    throw new Error("--yes requires --dsn (no interactive prompt available)");
  }
  return promptForDsn();
}

function printNextSteps(middlewarePath: string | null, cwd: string): void {
  process.stdout.write(`${pc.bold("Next steps")}\n`);
  process.stdout.write(
    `  ${pc.dim("1.")} Restart your dev server so the new env vars load.\n`,
  );

  if (middlewarePath) {
    const rel = relpath(cwd, middlewarePath);
    process.stdout.write(
      `  ${pc.dim("2.")} Wrap your middleware (${pc.cyan(rel)}):\n\n`,
    );
    const snippet = buildMiddlewareSnippet()
      .split("\n")
      .map((line) => `       ${line}`)
      .join("\n");
    process.stdout.write(`${pc.dim(snippet)}\n\n`);
  } else {
    process.stdout.write(
      `  ${pc.dim("2.")} If you add a middleware later, wrap it with ${pc.cyan(
        "wrapMiddleware",
      )}.\n`,
    );
  }

  process.stdout.write(
    `  ${pc.dim("3.")} For Route Handlers, wrap each export with ${pc.cyan(
      "wrapRoute",
    )} from ${pc.cyan("@volatodev/nextjs/server")}.\n`,
  );
  process.stdout.write(
    `  ${pc.dim("4.")} For Server Actions returning ${pc.cyan(
      "{ error }",
    )} (no throw), call ${pc.cyan(
      "reportActionError",
    )} from the catch branch.\n\n`,
  );
  process.stdout.write(
    `${pc.green("✓")} Done. ${pc.dim(
      "Trigger an error and check your Volato dashboard.",
    )}\n`,
  );
}
