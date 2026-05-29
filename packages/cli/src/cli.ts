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
 *
 * Every command accepts --json for the structured payload instead of
 * the default markdown. The markdown is agent-ready (the same string
 * the REST API serves under `markdown`); agents shell to `volato` and
 * print it directly.
 */
import { Command } from "commander";
import { runInit } from "./commands/init/init.js";
import { runLogin, runWhoami } from "./commands/login.js";
import {
  runErrorsList,
  runErrorsShow,
  runErrorsResolve,
} from "./commands/errors.js";
import { runReadme } from "./commands/readme.js";
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
  .description("Wire @volatodev/nextjs into the current Next.js project")
  .action(async () => {
    try {
      await runInit({ cwd: process.cwd() });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      printLocalError(message);
      process.exit(1);
    }
  });

program
  .command("login")
  .argument("[token]", "workspace bearer token from https://app.volato.dev")
  .description("Authenticate the CLI with a workspace token")
  .action(async (token: string | undefined) => {
    await runLogin({ token });
  });

program
  .command("whoami")
  .description("Confirm a token is loaded")
  .action(async () => {
    await runWhoami();
  });

program
  .command("readme")
  .description("Print the full command surface (markdown — agents read this)")
  .action(() => {
    runReadme();
  });

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
  process.exit(1);
});
