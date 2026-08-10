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
 *   volato init                       — link this repository to a Volato project
 *   volato errors init                — install detected Errors capture adapters
 *   volato errors list                — list error groups
 *   volato errors show [id]           — fix context (omit id → most recent)
 *   volato errors samples <id>        — bounded representative events
 *   volato errors resolve <id>        — mark resolved (append a note)
 *   volato errors reopen  <id>        — reopen (note preserved on history)
 *   volato errors ignore  <id>        — mark ignored
 *   volato releases list              — latest captured releases
 *   volato releases compare [head]    — compare a release to its predecessor
 *   volato projects origins set       — replace a browser-origin allowlist
 *   volato analytics init             — install generated Next.js analytics
 *   volato analytics validate         — validate .volato/analytics.json locally
 *   volato analytics sync             — publish the outcome event catalog
 *   volato analytics report           — read activation and retention evidence
 *   volato analytics snapshot save    — save an approved analytics snapshot
 *
 * Every command accepts --json for the structured payload instead of
 * the default markdown. The markdown is agent-ready (the same string
 * the REST API serves under `markdown`); agents shell to `volato` and
 * print it directly.
 */
import { Command } from "commander";
import { runInit } from "./commands/init/init.js";
import { runErrorsInit } from "./commands/init/errors.js";
import { runAnalyticsInit } from "./commands/init/analytics.js";
import { runLogin, runLogout, runWhoami } from "./commands/login.js";
import {
  runErrorSamples,
  runErrorsList,
  runErrorsShow,
  runErrorsResolve,
} from "./commands/errors.js";
import {
  runReleasesCompare,
  runReleasesList,
} from "./commands/releases.js";
import { runReadme } from "./commands/readme.js";
import { runSkillsInstall } from "./commands/skills.js";
import { runProjectOriginsSet } from "./commands/projects.js";
import {
  runUsageSnapshotSave,
  runUsageReport,
  runUsageSync,
  runUsageValidate,
} from "./commands/analytics.js";
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
    "Volato CLI — operational skills and observability for AI agents. Run `volato readme` for the full surface.",
  )
  .version(CLI_VERSION, "-v, --version", "print the volato CLI version");

program
  .command("init")
  .description("Link this repository to a Volato project")
  .option("--project <id>", "Volato project id")
  .option("--yes", "require non-interactive setup")
  .action(async (opts: {
    project?: string;
    yes?: boolean;
  }) => {
    try {
      await runInit({
        cwd: process.cwd(),
        projectId: opts.project,
        nonInteractive: opts.yes,
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
  .description("Install Volato operational and framework skills for AI agents")
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

const analytics = program
  .command("analytics")
  .description("Install and query outcome-led product analytics");

analytics
  .command("init")
  .description("Install generated Next.js Analytics from an approved contract")
  .option(
    "-f, --file <path>",
    "project-relative Analytics config path",
    ".volato/analytics.json",
  )
  .option("--yes", "apply safe setup defaults without prompts")
  .action(async (opts: { file: string; yes?: boolean }) => {
    try {
      await runAnalyticsInit({
        cwd: process.cwd(),
        file: opts.file,
        nonInteractive: opts.yes,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      printLocalError(message);
      process.exit(err instanceof CliError ? err.exitCode : 1);
    }
  });

analytics
  .command("validate")
  .description("Validate .volato/analytics.json locally")
  .option(
    "-f, --file <path>",
    "project-relative product Analytics config path",
    ".volato/analytics.json",
  )
  .option("--json", "emit the structured payload instead of markdown")
  .action(
    (opts: { file: string; json?: boolean }) => {
      runUsageValidate({ cwd: process.cwd(), ...opts });
    },
  );

analytics
  .command("sync")
  .description("Validate and publish the product Analytics event catalog")
  .option(
    "-f, --file <path>",
    "project-relative product Analytics config path",
    ".volato/analytics.json",
  )
  .option("--json", "emit the structured payload instead of markdown")
  .action(
    async (opts: { file: string; json?: boolean }) => {
      await runUsageSync({ cwd: process.cwd(), ...opts });
    },
  );

analytics
  .command("report")
  .description("Read activation, repeat-use, and retention evidence")
  .option(
    "-f, --file <path>",
    "project-relative product Analytics config path",
    ".volato/analytics.json",
  )
  .option("--json", "emit the structured payload instead of markdown")
  .action(
    async (opts: { file: string; json?: boolean }) => {
      await runUsageReport({ cwd: process.cwd(), ...opts });
    },
  );

const analyticsSnapshot = analytics
  .command("snapshot")
  .description("Save explicitly approved product Analytics snapshots");

analyticsSnapshot
  .command("save")
  .description("Validate and save an approved behavioral snapshot")
  .option(
    "-f, --file <path>",
    "project-relative product Analytics snapshot path",
    ".volato/analytics-snapshot.json",
  )
  .option("--json", "emit the structured payload instead of markdown")
  .action(
    async (opts: { file: string; json?: boolean }) => {
      await runUsageSnapshotSave({ cwd: process.cwd(), ...opts });
    },
  );

const errors = program
  .command("errors")
  .description("Install capture and operate production errors");

errors
  .command("init")
  .description("Install detected Next.js, Vite + React, and Node Errors adapters")
  .option("--yes", "apply safe setup defaults without prompts")
  .option(
    "--send-test-event",
    "send a synthetic error through the generated Next.js application path",
  )
  .action(async (opts: { yes?: boolean; sendTestEvent?: boolean }) => {
    try {
      await runErrorsInit({
        cwd: process.cwd(),
        nonInteractive: opts.yes,
        sendTestEvent: opts.sendTestEvent,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      printLocalError(message);
      process.exit(err instanceof CliError ? err.exitCode : 1);
    }
  });

errors
  .command("list")
  .description("List error groups across your workspace")
  .option(
    "-s, --status <status>",
    "filter: unresolved (default), resolved, ignored, all",
  )
  .option("-r, --release <release>", "scope to a release tag or commit SHA")
  .option(
    "--baseline-release <release>",
    "comparison baseline used by --sort growth (auto-detected when omitted)",
  )
  .option("-e, --environment <environment>", "scope environment (default: production)")
  .option("-q, --query <substring>", "case-insensitive match on error message")
  .option("--fingerprint <substring>", "case-insensitive fingerprint match")
  .option(
    "--runtime <runtime>",
    "scope runtime: browser, node, client, rsc, server_action, route_handler, middleware",
  )
  .option("--route <route>", "scope to an exact normalized route")
  .option("--first-seen-after <iso>", "group first seen at or after ISO timestamp")
  .option("--first-seen-before <iso>", "group first seen at or before ISO timestamp")
  .option("--last-seen-after <iso>", "group last seen at or after ISO timestamp")
  .option("--last-seen-before <iso>", "group last seen at or before ISO timestamp")
  .option(
    "--min-events <n>",
    "minimum matching events",
    (v) => Number.parseInt(v, 10),
  )
  .option(
    "--min-users <n>",
    "minimum distinct affected user ids",
    (v) => Number.parseInt(v, 10),
  )
  .option(
    "--sort <ranking>",
    "ranking: recent (default), new, users, events, growth",
  )
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
      baselineRelease?: string;
      environment?: string;
      query?: string;
      fingerprint?: string;
      runtime?: string;
      route?: string;
      firstSeenAfter?: string;
      firstSeenBefore?: string;
      lastSeenAfter?: string;
      lastSeenBefore?: string;
      minEvents?: number;
      minUsers?: number;
      sort?: string;
      projectId?: string;
      limit?: number;
      json?: boolean;
    }) => {
      await runErrorsList(opts);
    },
  );

errors
  .command("samples")
  .argument("<id>", "error group id")
  .description("Read a bounded set of privacy-filtered event samples")
  .option("-p, --project-id <id>", "scope to a single project")
  .option("-e, --environment <environment>", "scope environment (default: production)")
  .option("-r, --release <release>", "scope to a release")
  .option("--runtime <runtime>", "scope to a runtime")
  .option("--route <route>", "scope to an exact normalized route")
  .option(
    "--strategy <strategy>",
    "sample role: all (default), recent, representative, variations",
  )
  .option(
    "-l, --limit <n>",
    "max samples to return (1-10, default 5)",
    (v) => Number.parseInt(v, 10),
  )
  .option("--json", "emit the structured payload instead of markdown")
  .action(
    async (
      id: string,
      opts: {
        projectId?: string;
        environment?: string;
        release?: string;
        runtime?: string;
        route?: string;
        strategy?: string;
        limit?: number;
        json?: boolean;
      },
    ) => {
      await runErrorSamples({ id, ...opts });
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
  .option("-e, --environment <environment>", "scope environment (default: production)")
  .option("--json", "emit the structured payload instead of markdown")
  .action(
    async (
      id: string | undefined,
      opts: { projectId?: string; environment?: string; json?: boolean },
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

const releases = program
  .command("releases")
  .description("Read captured releases and compare their error groups");

releases
  .command("list")
  .description("List captured releases, newest first")
  .option("-p, --project-id <id>", "scope to a single project")
  .option("-e, --environment <environment>", "scope environment (default: production)")
  .option("--runtime <runtime>", "scope to a runtime")
  .option(
    "-l, --limit <n>",
    "max releases to return (1-100, default 20)",
    (v) => Number.parseInt(v, 10),
  )
  .option("--json", "emit the structured payload instead of markdown")
  .action(
    async (opts: {
      projectId?: string;
      environment?: string;
      runtime?: string;
      limit?: number;
      json?: boolean;
    }) => {
      await runReleasesList(opts);
    },
  );

releases
  .command("compare")
  .argument("[head]", "head release (default: latest captured release)")
  .description("Compare a release to a base or its captured predecessor")
  .option("--base <release>", "baseline release (default: captured predecessor)")
  .option("-p, --project-id <id>", "scope to a single project")
  .option("-e, --environment <environment>", "scope environment (default: production)")
  .option("--runtime <runtime>", "scope to a runtime")
  .option(
    "-l, --limit <n>",
    "max changed groups to return (1-100, default 20)",
    (v) => Number.parseInt(v, 10),
  )
  .option("--json", "emit the structured payload instead of markdown")
  .action(
    async (
      head: string | undefined,
      opts: {
        base?: string;
        projectId?: string;
        environment?: string;
        runtime?: string;
        limit?: number;
        json?: boolean;
      },
    ) => {
      await runReleasesCompare({ head, ...opts });
    },
  );

program.parseAsync(process.argv).catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  printLocalError(message);
  process.exit(err instanceof CliError ? err.exitCode : 1);
});
