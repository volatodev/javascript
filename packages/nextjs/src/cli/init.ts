/**
 * Orchestrator for `volato init`. Three responsibilities:
 *
 *   1. Drive the interactive flow (prompt for the DSN unless
 *      `--dsn` or `--yes` is supplied; bail cleanly on user
 *      abort).
 *   2. Call the pure patch primitives in `patch.ts` in the
 *      right order, threading the detected `ProjectShape` so
 *      each patch knows where to write.
 *   3. Print a final report — one line per touched file with
 *      its `created / updated / skipped / manual` outcome — so
 *      the dev sees exactly what was modified before running
 *      `next dev`.
 *
 * Why these three live in one orchestrator instead of inside
 * commander: the orchestrator stays pure (pass `cwd`, `dsn`,
 * `nonInteractive`) so a test can drive the full flow
 * end-to-end against a fixture project without spawning a
 * subprocess.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import pc from "picocolors";
import prompts from "prompts";
import { detectProject, DetectionError } from "./detect";
import {
  buildMiddlewareSnippet,
  patchEnvLocal,
  patchInstrumentation,
  patchLayout,
  patchNextConfig,
  patchTunnelRoute,
  type PatchOutcome,
  type PatchStatus,
} from "./patch";

export type InitOptions = {
  cwd: string;
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

/**
 * Look for a DSN in the project's env files. We try `.env.local`
 * first (Next.js convention for local overrides), then `.env`.
 * Within each file the first match wins among
 * `VOLATO_DSN` / `NEXT_PUBLIC_VOLATO_DSN`.
 *
 * Returns the DSN string + the file it came from for the confirm
 * prompt, or `null` when nothing matches.
 */
function findDsnInEnvFiles(
  cwd: string,
): { dsn: string; source: string } | null {
  const candidates = [".env.local", ".env"];
  const keys = ["VOLATO_DSN", "NEXT_PUBLIC_VOLATO_DSN"];
  for (const file of candidates) {
    let content: string;
    try {
      content = readFileSync(join(cwd, file), "utf8");
    } catch {
      continue;
    }
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq <= 0) continue;
      const key = trimmed.slice(0, eq).trim();
      if (!keys.includes(key)) continue;
      let value = trimmed.slice(eq + 1).trim();
      // Strip surrounding quotes if present (single or double).
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (isValidDsn(value)) return { dsn: value, source: file };
    }
  }
  return null;
}

/**
 * Build a "…d8b41" tail so the confirm prompt can identify which
 * project the detected DSN belongs to without dumping a full
 * 80-char URL on screen.
 */
function dsnTail(dsn: string): string {
  try {
    const url = new URL(dsn);
    const id = url.pathname.replace(/^\/+/, "");
    return id.length > 6 ? `…${id.slice(-6)}` : id;
  } catch {
    return "";
  }
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

  const dsn = await resolveDsn(options);
  if (!isValidDsn(dsn)) {
    throw new Error(`Invalid DSN: ${dsn}`);
  }

  const outcomes: PatchOutcome[] = [];
  outcomes.push(patchEnvLocal(cwd, dsn));
  outcomes.push(
    patchInstrumentation(project.instrumentationPath, project.language),
  );
  outcomes.push(patchLayout(project.layoutPath));
  outcomes.push(patchNextConfig(project.nextConfigPath));
  outcomes.push(patchTunnelRoute(project.tunnelRoutePath, project.language));

  for (const o of outcomes) printOutcome(cwd, o);
  process.stdout.write("\n");

  await maybeSendTestEvent(dsn);

  printNextSteps(project.middlewarePath, cwd);
}

/**
 * Offer to send a test event immediately after `init` succeeds.
 * Posts a synthetic error directly to the ingest endpoint with the
 * resolved DSN — same wire format as the SDK so the dashboard's
 * checklist step 3 flips green right away. The user has a "yes it
 * actually works" moment in the same terminal session, before they
 * even restart their dev server.
 *
 * The post is best-effort: a failure here doesn't abort init (the
 * project files are already patched). We print the error so the
 * user sees why and can debug separately.
 */
async function maybeSendTestEvent(dsn: string): Promise<void> {
  const response = await prompts(
    {
      type: "confirm",
      name: "send",
      message: "Send a test error now to verify the pipe?",
      initial: true,
    },
    {
      onCancel: () => {
        throw new Error("aborted by user");
      },
    },
  );
  if (!response.send) return;

  try {
    await sendTestEvent(dsn);
    process.stdout.write(
      `  ${pc.green("✓")} Test event sent — your Volato dashboard should flip to ${pc.green("Receiving")}.\n\n`,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stdout.write(
      `  ${pc.red("✗")} Could not send test event: ${pc.dim(msg)}\n` +
        `    ${pc.dim("Your project files were still patched — fix the ingest URL / network and retry.")}\n\n`,
    );
  }
}

async function sendTestEvent(dsn: string): Promise<void> {
  const url = new URL(dsn);
  const host = `${url.protocol}//${url.host}`;
  const event = {
    type: "error",
    timestamp: Date.now(),
    message: "Volato CLI test event — delete this group once captured",
    fingerprint: ["volato-cli-test"],
    runtime: "server_action",
    environment: "development",
  };

  const res = await fetch(`${host}/api/ingest`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Volato-DSN": dsn,
    },
    body: JSON.stringify(event),
  });
  if (!res.ok) {
    let detail = `${res.status} ${res.statusText}`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) detail = `${detail} — ${body.error}`;
    } catch {
      /* ignore body parse errors */
    }
    throw new Error(detail);
  }
}

async function resolveDsn(options: InitOptions): Promise<string> {
  const fromEnv = findDsnInEnvFiles(options.cwd);
  if (fromEnv) {
    const tail = dsnTail(fromEnv.dsn);
    const response = await prompts(
      {
        type: "confirm",
        name: "use",
        message: `DSN detected in ${fromEnv.source}${tail ? ` (${tail})` : ""} — use it?`,
        initial: true,
      },
      {
        onCancel: () => {
          throw new Error("aborted by user");
        },
      },
    );
    if (response.use) return fromEnv.dsn;
    // User said no → fall through to the manual prompt.
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
