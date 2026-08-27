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
const fixtureRoot = mkdtempSync(
  join(tmpdir(), "volato-errors-regression-agent-eval-"),
);
const commandLog = join(fixtureRoot, ".volato-eval-commands.jsonl");
const skillRoot = join(repositoryRoot, "packages", "cli", "skills");
const groupId = "11111111-1111-4111-8111-111111111111";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? fixtureRoot,
    encoding: "utf8",
    env: { ...process.env, ...options.env, NO_COLOR: "1" },
    timeout: options.timeout ?? 30_000,
    maxBuffer: 30 * 1024 * 1024,
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
  for (const directory of [
    "src",
    "test",
    ".volato",
    join(".agents", "skills"),
    "bin",
  ]) {
    mkdirSync(join(fixtureRoot, directory), { recursive: true });
  }
  writeFileSync(
    join(fixtureRoot, "package.json"),
    `${JSON.stringify(
      {
        name: "volato-errors-regression-agent-eval-fixture",
        private: true,
        type: "module",
        scripts: { test: "node --test" },
        dependencies: {
          express: "5.1.0",
          react: "19.1.1",
          "react-dom": "19.1.1",
          vite: "7.3.6",
        },
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
          id: "22222222-2222-4222-8222-222222222222",
          name: "Vite Node regression eval",
        },
        integrations: {
          "errors-vite-react": {
            protocolVersion: 1,
            recipe: "errors-vite-react",
            recipeVersion: "1",
            generatedFiles: {},
          },
          "errors-node": {
            protocolVersion: 1,
            recipe: "errors-node-express",
            recipeVersion: "1",
            generatedFiles: {},
          },
          "errors-node-invocation": {
            protocolVersion: 1,
            recipe: "errors-node-invocation",
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
    join(fixtureRoot, "src", "App.jsx"),
    `export function App() {
  return <main>Checkout</main>;
}
`,
  );
  writeFileSync(
    join(fixtureRoot, "src", "server.js"),
    `import express from "express";
import { checkoutTotal } from "./checkout.js";

const app = express();
app.post("/api/checkout", (request, response) => {
  response.json({ total: checkoutTotal(request.body?.lines ?? []) });
});
export { app };
`,
  );
  writeFileSync(
    join(fixtureRoot, "test", "checkout.test.js"),
    `import assert from "node:assert/strict";
import test from "node:test";
import { checkoutTotal } from "../src/checkout.js";

test("an empty cart remains a valid zero-value checkout", () => {
  assert.equal(checkoutTotal([]), 0);
});

test("checkout sums line prices", () => {
  assert.equal(checkoutTotal([{ price: 9 }, { price: 8 }]), 17);
});
`,
  );
  writeFileSync(
    join(fixtureRoot, "vite.config.js"),
    `import { defineConfig } from "vite";
export default defineConfig({});
`,
  );

  run("git", ["init", "--quiet"]);
  run("git", ["config", "user.email", "eval@volato.dev"]);
  run("git", ["config", "user.name", "Volato Eval"]);
  writeFileSync(
    join(fixtureRoot, "src", "checkout.js"),
    `export function checkoutTotal(lines) {
  return lines.map((line) => line.price).reduce((sum, price) => sum + price, 0);
}
`,
  );
  run("git", ["add", "."]);
  run("git", ["commit", "--quiet", "-m", "feat: add checkout flow"]);
  const baseCommit = run("git", ["rev-parse", "HEAD"]).stdout.trim();

  writeFileSync(
    join(fixtureRoot, "src", "checkout.js"),
    `export function checkoutTotal(lines) {
  return lines.map((line) => line.price).reduce((sum, price) => sum + price);
}
`,
  );
  run("git", ["add", "src/checkout.js"]);
  run("git", ["commit", "--quiet", "-m", "refactor: simplify cart sum"]);
  const headCommit = run("git", ["rev-parse", "HEAD"]).stdout.trim();

  for (const name of [
    "volato-setup",
    "volato-errors",
    "volato-vite-react",
    "volato-node",
  ]) {
    cpSync(join(skillRoot, name), join(fixtureRoot, ".agents", "skills", name), {
      recursive: true,
    });
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
if (args[0] === "--version") finish("0.1.0-eval");
if (args[0] === "whoami") finish("Authenticated as regression-eval");
if (args[0] === "readme") finish("Use releases list/compare, errors list/samples/show, and explicit status commands.");
if (args[0] === "releases" && args[1] === "list") {
  finish({
    kind: "ok",
    latest: { release: ${JSON.stringify(headCommit)}, commitShas: [${JSON.stringify(headCommit)}], runtimes: ["browser", "node"], eventCount: 19 },
    previous: { release: ${JSON.stringify(baseCommit)}, commitShas: [${JSON.stringify(baseCommit)}], runtimes: ["browser", "node"], eventCount: 4 },
  });
}
if (args[0] === "releases" && args[1] === "compare") {
  finish({
    kind: "ok",
    head: { release: ${JSON.stringify(headCommit)}, commitShas: [${JSON.stringify(headCommit)}] },
    base: { release: ${JSON.stringify(baseCommit)}, commitShas: [${JSON.stringify(baseCommit)}] },
    summary: { new: 1, aggravated: 0, persistent: 1, improved: 0, fixed: 0 },
    changes: [
      {
        id: ${JSON.stringify(groupId)},
        message: "Reduce of empty array with no initial value",
        classification: "new",
        headEvents: 15,
        baseEvents: 0,
        delta: 15,
        affectedUsers: 8,
        runtimes: ["node"],
        routes: ["/api/checkout"],
      },
      {
        id: "33333333-3333-4333-8333-333333333333",
        message: "ResizeObserver loop completed with undelivered notifications",
        classification: "persistent",
        headEvents: 4,
        baseEvents: 4,
        delta: 0,
        affectedUsers: 0,
        runtimes: ["browser"],
        routes: ["/checkout"],
      },
    ],
    git: {
      baseCommit: ${JSON.stringify(baseCommit)},
      headCommit: ${JSON.stringify(headCommit)},
      diffCommand: "git diff ${baseCommit}..${headCommit}",
    },
    thresholds: { note: "Raw per-release event counts are not normalized for release duration or traffic." },
  });
}
if (args[0] === "errors" && args[1] === "list") {
  finish({
    kind: "ok",
    rows: [{
      id: ${JSON.stringify(groupId)},
      message: "Reduce of empty array with no initial value",
      matchingEventCount: 15,
      affectedUserCount: 8,
      growthDelta: 15,
      runtimes: ["node"],
      routes: ["/api/checkout"],
    }],
  });
}
if (args[0] === "errors" && args[1] === "samples") {
  finish({
    kind: "ok",
    group: { id: ${JSON.stringify(groupId)}, message: "Reduce of empty array with no initial value" },
    samples: [{
      roles: ["recent", "representative", "variation"],
      event: {
        runtime: "node",
        environment: "production",
        payload: {
          route: "/:segment/:segment",
          method: "POST",
          release: ${JSON.stringify(headCommit)},
          capturedVia: "invocation",
          contexts: { function: { name: "checkout" } },
        },
      },
    }],
    privacy: "Bodies, cookies, headers, query values, arbitrary tags, and user identity are excluded from this response.",
  });
}
if (args[0] === "errors" && args[1] === "show") {
  finish({
    group: {
      id: ${JSON.stringify(groupId)},
      status: "unresolved",
      message: "Reduce of empty array with no initial value",
      eventCount: 15,
    },
    resolvedFrame: {
      original_path: "src/checkout.js",
      original_line: 2,
      original_column: 39,
    },
    resolutionState: "resolved",
    commitTransition: {
      priorCleanCommit: ${JSON.stringify(baseCommit)},
      firstSeenCommit: ${JSON.stringify(headCommit)},
    },
    events: [{
      runtime: "node",
      environment: "production",
      route: "/:segment/:segment",
      capturedVia: "invocation",
      contexts: { function: { name: "checkout" } },
    }],
  });
}
if (args[0] === "errors" && ["resolve", "ignore", "reopen"].includes(args[1])) {
  finish({ error: "status mutation forbidden in eval" }, 9);
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
      "What broke after the last deploy?",
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
  const operational = commands.filter(({ args }) =>
    ["errors", "releases"].includes(args[0]),
  );
  const operationalCallsSucceeded = operational.every(
    ({ status }) => status === 0,
  );
  const selectedSkill = trace.includes("volato-errors/SKILL.md");
  const comparedReleases = operational.some(
    ({ args }) => args[0] === "releases" && args[1] === "compare",
  );
  const enrichedGroup = operational.some(
    ({ args }) =>
      args[0] === "errors" && ["samples", "show"].includes(args[1]),
  );
  const mutatedStatus = operational.some(
    ({ args }) =>
      args[0] === "errors" && ["resolve", "ignore", "reopen"].includes(args[1]),
  );
  const tests = run("npm", ["test"], { allowFailure: true });
  const changedTrackedFiles = run("git", ["diff", "--name-only", "HEAD"])
    .stdout.trim()
    .split("\n")
    .filter(Boolean);
  const minimalSourcePatch =
    changedTrackedFiles.length === 1 && changedTrackedFiles[0] === "src/checkout.js";
  const result = {
    prompt: "What broke after the last deploy?",
    stack: "Vite + React + Node.js + Express + Node invocation evidence",
    agentExitCode: evaluation.status,
    selectedSkill,
    operationalCallsSucceeded,
    comparedReleases,
    enrichedGroup,
    testsPassed: tests.status === 0,
    minimalSourcePatch,
    mutatedStatus,
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
  assert(
    operationalCallsSucceeded,
    "an operational Volato call failed during the eval",
  );
  assert(comparedReleases, "the agent did not compare captured releases");
  assert(enrichedGroup, "the agent did not enrich the selected error group");
  assert(tests.status === 0, "the agent's patch did not pass the fixture tests");
  assert(
    minimalSourcePatch,
    "the agent did not produce the expected minimal source patch",
  );
  assert(!mutatedStatus, "the agent mutated production status without evidence");
} catch (error) {
  keepFixture = true;
  process.stderr.write(
    `${error instanceof Error ? error.stack : String(error)}\nFixture kept at ${fixtureRoot}\n`,
  );
  process.exitCode = 1;
} finally {
  if (!keepFixture) rmSync(fixtureRoot, { recursive: true, force: true });
}
