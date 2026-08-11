import { spawnSync } from "node:child_process";
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fixtureRoot = mkdtempSync(join(tmpdir(), "volato-errors-agent-eval-"));
const commandLog = join(fixtureRoot, ".volato-eval-commands.jsonl");
const skillRoot = join(repositoryRoot, "packages", "cli", "skills");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? fixtureRoot,
    encoding: "utf8",
    env: { ...process.env, ...options.env, NO_COLOR: "1" },
    timeout: options.timeout ?? 30_000,
    maxBuffer: 20 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0 && !options.allowFailure) {
    throw new Error(
      `${command} ${args.join(" ")} failed (${result.status})\n${result.stdout}\n${result.stderr}`,
    );
  }
  return result;
}

function writeFixture() {
  mkdirSync(join(fixtureRoot, "src"), { recursive: true });
  mkdirSync(join(fixtureRoot, "test"), { recursive: true });
  mkdirSync(join(fixtureRoot, ".volato"), { recursive: true });
  mkdirSync(join(fixtureRoot, ".agents", "skills"), { recursive: true });
  mkdirSync(join(fixtureRoot, "bin"), { recursive: true });

  writeFileSync(
    join(fixtureRoot, "package.json"),
    `${JSON.stringify(
      {
        name: "volato-errors-agent-eval-fixture",
        private: true,
        type: "module",
        scripts: { test: "node --test" },
        dependencies: { next: "16.2.12", react: "19.2.8", "react-dom": "19.2.8" },
      },
      null,
      2,
    )}\n`,
  );
  writeFileSync(
    join(fixtureRoot, ".volato", "manifest.json"),
    `${JSON.stringify(
      {
        schemaVersion: 2,
        project: {
          id: "11111111-1111-4111-8111-111111111111",
          name: "Errors Agent Eval",
        },
        integrations: {
          "errors-nextjs": {
            protocolVersion: 1,
            recipe: "errors-nextjs-app-router",
            recipeVersion: "1",
            generatedFiles: {},
          },
        },
      },
      null,
      2,
    )}\n`,
  );
  writeFileSync(
    join(fixtureRoot, "test", "profile.test.js"),
    `import assert from "node:assert/strict";
import test from "node:test";
import { displayName } from "../src/profile.js";

test("falls back when the production payload has no user", () => {
  assert.equal(displayName({}), "Anonymous");
});
`,
  );

  run("git", ["init", "--quiet"]);
  run("git", ["config", "user.email", "eval@volato.dev"]);
  run("git", ["config", "user.name", "Volato Eval"]);
  writeFileSync(
    join(fixtureRoot, "src", "profile.js"),
    `export function displayName(payload) {
  return payload.user?.name?.trim() || "Anonymous";
}
`,
  );
  run("git", [
    "add",
    ".volato/manifest.json",
    "package.json",
    "src/profile.js",
    "test/profile.test.js",
  ]);
  run("git", ["commit", "--quiet", "-m", "feat: add resilient profile display"]);
  const priorCleanCommit = run("git", ["rev-parse", "HEAD"]).stdout.trim();

  writeFileSync(
    join(fixtureRoot, "src", "profile.js"),
    `export function displayName(payload) {
  return payload.user.name.trim();
}
`,
  );
  run("git", ["add", "src/profile.js"]);
  run("git", ["commit", "--quiet", "-m", "refactor: simplify profile display"]);
  const firstSeenCommit = run("git", ["rev-parse", "HEAD"]).stdout.trim();

  for (const name of [
    "volato-setup",
    "volato-errors",
    "volato-nextjs",
    "volato-product",
  ]) {
    const source = join(skillRoot, name);
    if (existsSync(source)) {
      cpSync(source, join(fixtureRoot, ".agents", "skills", name), {
        recursive: true,
      });
    }
  }

  const mock = `#!/usr/bin/env node
import { appendFileSync } from "node:fs";

const args = process.argv.slice(2);
function finish(payload, status = 0) {
  const output = typeof payload === "string" ? payload : JSON.stringify(payload);
  appendFileSync(
    process.env.VOLATO_EVAL_LOG,
    JSON.stringify({ args, responseBytes: Buffer.byteLength(output), status }) + "\\n",
  );
  (status === 0 ? console.log : console.error)(output);
  process.exit(status);
}

if (args[0] === "--version") {
  finish("0.1.0-eval");
}
if (args[0] === "whoami") {
  finish("Authenticated as eval@volato.dev");
}
if (args[0] === "errors" && args[1] === "show") {
  const data = {
    group: {
      id: "11111111-1111-4111-8111-111111111111",
      status: "unresolved",
      message: "Cannot read properties of undefined (reading 'name')",
      eventCount: 47,
    },
    resolvedFrame: {
      original_path: "src/profile.js",
      original_line: 2,
      original_column: 23,
    },
    resolutionState: "resolved",
    commitTransition: {
      priorCleanCommit: ${JSON.stringify(priorCleanCommit)},
      firstSeenCommit: ${JSON.stringify(firstSeenCommit)},
    },
    events: [{ runtime: "client", environment: "production" }],
  };
  if (args.includes("--json")) {
    finish(data);
  } else {
    finish("# TypeError: Cannot read properties of undefined (reading 'name')\\n\\n" +
      "**Status:** unresolved · **Occurrences:** 47\\n" +
      "**Source:** src/profile.js:2:23\\n" +
      "**Commit since clean:** ${priorCleanCommit}..${firstSeenCommit}\\n" +
      "**Runtime:** client · **Environment:** production\\n\\n" +
      "The production payload can omit user. Inspect the source and commit transition before patching.");
  }
}
if (args[0] === "errors" && args[1] === "samples") {
  finish({
    kind: "ok",
    group: {
      id: "11111111-1111-4111-8111-111111111111",
      message: "Cannot read properties of undefined (reading 'name')",
    },
    samples: [{
      roles: ["recent", "representative"],
      event: { runtime: "client", environment: "production" },
    }],
  });
}
if (args[0] === "errors" && args[1] === "resolve") {
  finish({ status: "resolved" });
}
finish("Unsupported eval command: volato " + args.join(" "), 2);
`;
  const mockPath = join(fixtureRoot, "bin", "volato");
  writeFileSync(mockPath, mock);
  chmodSync(mockPath, 0o755);
}

function parseCommands() {
  if (!existsSync(commandLog)) return [];
  return readFileSync(commandLog, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function usageFromTrace(trace) {
  let result = null;
  for (const line of trace.split("\n")) {
    if (!line.trim().startsWith("{")) continue;
    try {
      const event = JSON.parse(line);
      const usage = event.usage ?? event.data?.usage;
      if (usage && typeof usage === "object") result = usage;
    } catch {
      // Non-JSON stderr is retained in the trace but carries no usage data.
    }
  }
  return result;
}

let keepFixture = process.env.VOLATO_KEEP_EVAL === "1";

try {
  writeFixture();
  const startedAt = Date.now();
  const evaluation = run(
    "codex",
    [
      "exec",
      "--ephemeral",
      "--ignore-user-config",
      "--sandbox",
      "workspace-write",
      "--json",
      "-c",
      'shell_environment_policy.inherit="all"',
      "-C",
      fixtureRoot,
      "Fix the latest production error.",
    ],
    {
      allowFailure: true,
      timeout: 10 * 60_000,
      env: {
        PATH: `${join(fixtureRoot, "bin")}:${process.env.PATH ?? ""}`,
        VOLATO_EVAL_LOG: commandLog,
      },
    },
  );
  const wallClockMs = Date.now() - startedAt;
  const trace = `${evaluation.stdout}\n${evaluation.stderr}`;
  writeFileSync(join(fixtureRoot, ".volato-eval-trace.jsonl"), trace);
  const commands = parseCommands();
  const selectedSkill = trace.includes("volato-errors/SKILL.md");
  const calledVolato = commands.some(
    ({ args }) => args[0] === "errors" && args[1] === "show",
  );
  const scopedCurrentProject = commands.some(
    ({ args }) =>
      args[0] === "errors" &&
      args[1] === "show" &&
      args.includes("--project-id") &&
      args.includes("11111111-1111-4111-8111-111111111111"),
  );
  const resolvedBeforeDeploy = commands.some(
    ({ args }) => args[0] === "errors" && args[1] === "resolve",
  );
  const operational = commands.filter(({ args }) => args[0] === "errors");
  const operationalCallsSucceeded = operational.every(
    ({ status }) => status === 0,
  );
  const tests = run("npm", ["test"], { allowFailure: true });
  const changedTrackedFiles = run("git", ["diff", "--name-only", "HEAD"])
    .stdout.trim()
    .split("\n")
    .filter(Boolean);
  const minimalSourcePatch =
    changedTrackedFiles.length === 1 &&
    changedTrackedFiles[0] === "src/profile.js";
  const result = {
    prompt: "Fix the latest production error.",
    agentExitCode: evaluation.status,
    selectedSkill,
    calledVolato,
    scopedCurrentProject,
    operationalCallsSucceeded,
    testsPassed: tests.status === 0,
    minimalSourcePatch,
    resolvedBeforeDeploy,
    metrics: {
      wallClockMs,
      operationalVolatoCalls: operational.length,
      operationalResponseBytes: operational.reduce(
        (sum, entry) => sum + entry.responseBytes,
        0,
      ),
      agentTraceBytes: Buffer.byteLength(trace),
      usage: usageFromTrace(trace),
    },
    commands,
  };
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);

  assert(evaluation.status === 0, "the fresh coding agent did not complete");
  assert(selectedSkill, "the agent did not select volato-errors");
  assert(calledVolato, "the agent did not invoke Volato from the natural prompt");
  assert(
    scopedCurrentProject,
    "the agent did not scope the latest error to the repository's linked project",
  );
  assert(
    operationalCallsSucceeded,
    "an operational Volato call failed during the eval",
  );
  assert(tests.status === 0, "the agent's patch did not pass the fixture tests");
  assert(
    minimalSourcePatch,
    "the agent did not produce the expected minimal source patch",
  );
  assert(
    !resolvedBeforeDeploy,
    "the agent resolved the production group without deployment evidence",
  );
} catch (error) {
  keepFixture = true;
  process.stderr.write(
    `${error instanceof Error ? error.stack : String(error)}\nFixture kept at ${fixtureRoot}\n`,
  );
  process.exitCode = 1;
} finally {
  if (!keepFixture) rmSync(fixtureRoot, { recursive: true, force: true });
}
