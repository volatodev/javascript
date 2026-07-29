/**
 * `volato` CLI entry point.
 *
 * Bundled CJS with its deps (`commander`, `prompts`, `picocolors`) via
 * tsup's `noExternal` — end users pay no transitive install cost. The
 * top-level command surface:
 *
 *   volato login [token]              — write the workspace bearer to disk
 *   volato whoami                     — confirm a token is loaded
 *   volato readme                     — print full command surface (markdown)
 *   volato errors list                — list error groups
 *   volato errors show [id]           — fix context (omit id → most recent)
 *   volato errors resolve <id>        — mark resolved (append a note)
 *   volato errors reopen  <id>        — reopen (note preserved on history)
 *   volato errors ignore  <id>        — mark ignored
 *   volato projects origins set       — replace a browser-origin allowlist
 *   volato pmf validate                — validate .volato/pmf.json locally
 *   volato pmf sync                    — publish the outcome event catalog
 *   volato pmf report                  — read activation and retention evidence
 *
 * Every command accepts --json for the structured payload instead of
 * the default markdown. The markdown is agent-ready (the same string
 * the REST API serves under `markdown`); agents shell to `volato` and
 * print it directly.
 */
import { Command } from "commander";
import { runInit } from "./commands/init/init.js";
import { runLogin, runLogout, runWhoami } from "./commands/login.js";
import {
  runErrorsList,
  runErrorsShow,
  runErrorsResolve,
} from "./commands/errors.js";
import { runReadme } from "./commands/readme.js";
import { runSkillsInstall } from "./commands/skills.js";
import { runProjectOriginsSet } from "./commands/projects.js";
import {
  runPmfReport,
  runPmfSync,
  runPmfValidate,
} from "./commands/pmf.js";
import { CliError } from "./lib/api-client.js";
import { printLocalError } from "./lib/output.js";

// Replaced at build time by tsup's `define` (see tsup.config.ts). The
// fallback keeps `tsc`/tests honest when the bundle isn't built.
declare const __CLI_VERSION__: string;
const CLI_VERSION =
  typeof __CLI_VERSION__ === "string" ? __CLI_VERSION__ : "0.0.0-dev";

const program = new Command();

program
  .name("volato")
  .description(
    "Volato CLI — agent-native error tracking. Run `volato readme` for the full surface.",
  )
  .version(CLI_VERSION, "-v, --version", "print the volato CLI version");

program
  .command("init")
  .description("Generate the dependency-free Volato integration for this project")
  .option("--project <id>", "load this project's setup through the authenticated CLI")
  .option("--dsn <dsn>", "project DSN (avoids the interactive prompt)")
  .option("--yes", "apply safe setup defaults without prompts")
  .option(
    "--send-test-event",
    "send a synthetic event after non-interactive setup",
  )
  .action(async (opts: {
    project?: string;
    dsn?: string;
    yes?: boolean;
    sendTestEvent?: boolean;
  }) => {
    try {
      await runInit({
        cwd: process.cwd(),
        projectId: opts.project,
        dsn: opts.dsn,
        nonInteractive: opts.yes,
        sendTestEvent: opts.sendTestEvent,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      printLocalError(message);
      process.exit(1);
    }
  });

const skills = program
  .command("skills")
  .description("Install the agent skills carried by this CLI");

skills
  .command("install")
  .description("Install the generic Volato skill and supported framework skills")
  .option(
    "--target <directory>",
    "project-relative agent skills directory",
    ".agents/skills",
  )
  .option("--force", "replace differing installed skill files")
  .action(async (opts: { target: string; force?: boolean }) => {
    try {
      await runSkillsInstall({
        cwd: process.cwd(),
        target: opts.target,
        force: opts.force,
        nonInteractive: !process.stdin.isTTY || !process.stdout.isTTY,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      printLocalError(message);
      process.exit(1);
    }
  });

program
  .command("login")
  .argument("[token]", "workspace token (omit for the browser code flow)")
  .option("--stdin", "read the token from stdin (CI: echo \"$VOLATO_TOKEN\" | volato login --stdin)")
  .description("Authenticate the CLI (browser code flow, or pass a token)")
  .action(async (token: string | undefined, opts: { stdin?: boolean }) => {
    await runLogin({ token, stdin: opts.stdin });
  });

program
  .command("whoami")
  .description("Confirm a token is loaded")
  .action(async () => {
    await runWhoami();
  });

program
  .command("logout")
  .description("Remove the stored workspace token")
  .action(async () => {
    await runLogout();
  });

program
  .command("readme")
  .description("Print the full command surface (markdown — agents read this)")
  .action(() => {
    runReadme();
  });

const projects = program
  .command("projects")
  .description("Configure projects through the authenticated CLI");

const projectOrigins = projects
  .command("origins")
  .description("Manage browser origins allowed to submit events");

projectOrigins
  .command("set")
  .argument("<project-id>", "project id")
  .argument("[origins...]", "complete list of allowed http(s) origins")
  .option(
    "--clear",
    "clear the restriction and accept browser events from any origin",
  )
  .option("--json", "emit the structured payload instead of markdown")
  .description("Replace or clear a project's browser-origin allowlist")
  .action(
    async (
      projectId: string,
      origins: string[],
      opts: { clear?: boolean; json?: boolean },
    ) => {
      await runProjectOriginsSet({ projectId, origins, ...opts });
    },
  );

const pmf = program
  .command("pmf")
  .description("Configure and assess outcome-led PMF signals");

pmf
  .command("validate")
  .description("Validate .volato/pmf.json locally")
  .option(
    "-f, --file <path>",
    "project-relative PMF config path",
    ".volato/pmf.json",
  )
  .option("-p, --project-id <id>", "override the project id")
  .option("--json", "emit the structured payload instead of markdown")
  .action(
    (opts: { file: string; projectId?: string; json?: boolean }) => {
      runPmfValidate({ cwd: process.cwd(), ...opts });
    },
  );

pmf
  .command("sync")
  .description("Validate and publish the PMF event catalog")
  .option(
    "-f, --file <path>",
    "project-relative PMF config path",
    ".volato/pmf.json",
  )
  .option("-p, --project-id <id>", "override the project id")
  .option("--json", "emit the structured payload instead of markdown")
  .action(
    async (opts: { file: string; projectId?: string; json?: boolean }) => {
      await runPmfSync({ cwd: process.cwd(), ...opts });
    },
  );

pmf
  .command("report")
  .description("Read activation, repeat-use, and retention evidence")
  .option(
    "-f, --file <path>",
    "project-relative PMF config path",
    ".volato/pmf.json",
  )
  .option("-p, --project-id <id>", "override the project id")
  .option("--json", "emit the structured payload instead of markdown")
  .action(
    async (opts: { file: string; projectId?: string; json?: boolean }) => {
      await runPmfReport({ cwd: process.cwd(), ...opts });
    },
  );

const errors = program
  .command("errors")
  .description("Read and triage error groups");

errors
  .command("list")
  .description("List error groups across your workspace")
  .option(
    "-s, --status <status>",
    "filter: unresolved (default), resolved, ignored, all",
  )
  .option("-r, --release <release>", "scope to a release tag or commit SHA")
  .option("-q, --query <substring>", "case-insensitive match on error message")
  .option("-p, --project-id <id>", "scope to a single project")
  .option(
    "-l, --limit <n>",
    "max groups to return (1-100, default 50)",
    (v) => Number.parseInt(v, 10),
  )
  .option("--json", "emit the structured payload instead of markdown")
  .action(
    async (opts: {
      status?: string;
      release?: string;
      query?: string;
      projectId?: string;
      limit?: number;
      json?: boolean;
    }) => {
      await runErrorsList(opts);
    },
  );

errors
  .command("show")
  .argument(
    "[id]",
    "error group id (omit to get the most recent unresolved group)",
  )
  .description("One-call fix context for an error group")
  .option("-p, --project-id <id>", "scope to a single project")
  .option("--json", "emit the structured payload instead of markdown")
  .action(
    async (
      id: string | undefined,
      opts: { projectId?: string; json?: boolean },
    ) => {
      await runErrorsShow({ id, ...opts });
    },
  );

errors
  .command("resolve")
  .argument("<id>", "error group id")
  .description("Mark an error group as resolved")
  .option("-n, --note <text>", "audit note (e.g. 'fixed in PR #123')")
  .option("--json", "emit the structured payload instead of markdown")
  .action(async (id: string, opts: { note?: string; json?: boolean }) => {
    await runErrorsResolve({ id, action: "resolved", ...opts });
  });

errors
  .command("reopen")
  .argument("<id>", "error group id")
  .description("Reopen a previously-resolved group (prior notes preserved)")
  .option("-n, --note <text>", "why it came back")
  .option("--json", "emit the structured payload instead of markdown")
  .action(async (id: string, opts: { note?: string; json?: boolean }) => {
    await runErrorsResolve({ id, action: "reopened", ...opts });
  });

errors
  .command("ignore")
  .argument("<id>", "error group id")
  .description("Mark an error group as ignored (noise)")
  .option("-n, --note <text>", "why it's noise")
  .option("--json", "emit the structured payload instead of markdown")
  .action(async (id: string, opts: { note?: string; json?: boolean }) => {
    await runErrorsResolve({ id, action: "ignored", ...opts });
  });

program.parseAsync(process.argv).catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  printLocalError(message);
  process.exit(err instanceof CliError ? err.exitCode : 1);
});
