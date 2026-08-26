import { spawn, spawnSync } from "node:child_process";
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fixtureRoot = mkdtempSync(join(tmpdir(), "volato-errors-setup-agent-eval-"));
const commandLog = join(fixtureRoot, ".volato-eval-commands.jsonl");
const requestLog = join(fixtureRoot, ".volato-eval-requests.jsonl");
const serverPortFile = join(fixtureRoot, ".volato-eval-port");
const cliInstallRoot = mkdtempSync(
  join(tmpdir(), "volato-errors-setup-agent-cli-"),
);
let skillRoot = "";
let realCli = "";
const projectId = "44444444-4444-4444-8444-444444444444";

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

function runAgent(args, options = {}) {
  return new Promise((resolveResult) => {
    const child = spawn("codex", args, {
      cwd: fixtureRoot,
      detached: process.platform !== "win32",
      env: { ...process.env, ...options.env, NO_COLOR: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    const terminate = (signal) => {
      try {
        if (process.platform === "win32") child.kill(signal);
        else process.kill(-child.pid, signal);
      } catch {
        // The process may have exited between the timeout and this signal.
      }
    };
    const timer = setTimeout(() => {
      timedOut = true;
      terminate("SIGTERM");
      setTimeout(() => terminate("SIGKILL"), 2_000).unref();
    }, options.timeout ?? 7 * 60_000);
    child.on("error", (error) => {
      clearTimeout(timer);
      resolveResult({ status: 1, stdout, stderr: `${stderr}\n${error.stack ?? error}` });
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      resolveResult({
        status: timedOut ? 124 : (code ?? 1),
        stdout,
        stderr: timedOut
          ? `${stderr}\nAgent eval timed out and was terminated.`
          : signal
            ? `${stderr}\nAgent eval exited from ${signal}.`
            : stderr,
      });
    });
  });
}

function installPackagedCli() {
  const packageRoot = join(repositoryRoot, "packages", "cli");
  const packRoot = join(cliInstallRoot, "pack");
  mkdirSync(packRoot, { recursive: true });
  writeFileSync(
    join(cliInstallRoot, "package.json"),
    `${JSON.stringify(
      { name: "volato-setup-agent-cli-host", private: true },
      null,
      2,
    )}\n`,
  );
  const npmEnv = { npm_config_cache: join(cliInstallRoot, "npm-cache") };
  run(
    "npm",
    ["pack", "--ignore-scripts", "--pack-destination", packRoot],
    { cwd: packageRoot, env: npmEnv, timeout: 120_000 },
  );
  const archive = readdirSync(packRoot).find((name) => name.endsWith(".tgz"));
  assert(archive, "npm pack returned no CLI archive");
  run(
    "npm",
    [
      "install",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      join(packRoot, archive),
    ],
    { cwd: cliInstallRoot, env: npmEnv, timeout: 120_000 },
  );
  const installedRoot = join(
    cliInstallRoot,
    "node_modules",
    "@volatodev",
    "cli",
  );
  realCli = join(installedRoot, "dist", "cli.cjs");
  skillRoot = join(installedRoot, "skills");
  assert(existsSync(realCli), "packed CLI executable was not installed");
  assert(existsSync(skillRoot), "packed CLI skills were not installed");
  return JSON.parse(readFileSync(join(installedRoot, "package.json"), "utf8"));
}

function waitForFile(path, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (!existsSync(path) && Date.now() < deadline) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
  }
  assert(existsSync(path), `timed out waiting for ${path}`);
}

function writeFixture() {
  for (const directory of [
    "src",
    "test",
    "scripts",
    "bin",
    join(".agents", "skills"),
  ]) {
    mkdirSync(join(fixtureRoot, directory), { recursive: true });
  }

  writeFileSync(
    join(fixtureRoot, "AGENTS.md"),
    `# Eval context\n\nThe human already selected and authorized Volato project \`${projectId}\`. No additional authorization is required.\n`,
  );
  writeFileSync(
    join(fixtureRoot, ".gitignore"),
    ".env.local\ndist/\n.volato-eval-*\n",
  );
  writeFileSync(
    join(fixtureRoot, "package.json"),
    `${JSON.stringify(
      {
        name: "volato-errors-setup-agent-eval-fixture",
        private: true,
        type: "module",
        scripts: {
          build: "node scripts/build.mjs --source-map",
          test: "node --test",
        },
        dependencies: {
          express: "^5.1.0",
          react: "^19.2.0",
          "react-dom": "^19.2.0",
          vite: "^7.3.0",
        },
      },
      null,
      2,
    )}\n`,
  );
  writeFileSync(
    join(fixtureRoot, "src", "App.tsx"),
    `export function App() {\n  return <main>Volato setup eval</main>;\n}\n`,
  );
  writeFileSync(
    join(fixtureRoot, "src", "main.tsx"),
    `import { createRoot } from "react-dom/client";\nimport { App } from "./App";\n\ncreateRoot(document.getElementById("root")!).render(<App />);\n`,
  );
  writeFileSync(
    join(fixtureRoot, "src", "server.ts"),
    `import express from "express";\n\nconst app = express();\napp.get("/api/health", (_request, response) => response.json({ ok: true }));\napp.listen(3000);\n`,
  );
  writeFileSync(
    join(fixtureRoot, "vite.config.ts"),
    `import { defineConfig } from "vite";\n\nexport default defineConfig({ plugins: [] });\n`,
  );
  writeFileSync(
    join(fixtureRoot, "scripts", "build.mjs"),
    `import assert from "node:assert/strict";\nimport { mkdirSync, readFileSync, writeFileSync } from "node:fs";\n\nconst main = readFileSync("src/main.tsx", "utf8");\nconst server = readFileSync("src/server.ts", "utf8");\nconst vite = readFileSync("vite.config.ts", "utf8");\nconst manifest = JSON.parse(readFileSync(".volato/manifest.json", "utf8"));\nassert.match(main, /VolatoErrorBoundary/);\nassert.match(server, /initVolatoNode/);\nassert.match(server, /volatoExpressErrorHandler/);\nassert.match(vite, /withVolato/);\nassert.ok(manifest.integrations["errors-vite-react"]);\nassert.ok(manifest.integrations["errors-node"]);\nmkdirSync("dist", { recursive: true });\nwriteFileSync("dist/server.js", "throw new Error('controlled build artifact');\\n");\nwriteFileSync("dist/server.js.map", JSON.stringify({ version: 3, file: "server.js", sources: ["../src/server.ts"], sourcesContent: ["private fixture source"], names: [], mappings: "AAAA" }));\nwriteFileSync(".volato-eval-build.json", JSON.stringify({ browser: true, node: true, express: true }));\n`,
  );
  writeFileSync(
    join(fixtureRoot, "test", "setup.test.js"),
    `import assert from "node:assert/strict";\nimport test from "node:test";\nimport { readFileSync } from "node:fs";\n\ntest("both independent adapters are composed", () => {\n  assert.match(readFileSync("src/main.tsx", "utf8"), /VolatoErrorBoundary/);\n  assert.match(readFileSync("src/server.ts", "utf8"), /volatoExpressErrorHandler/);\n});\n`,
  );

  for (const name of ["volato-setup", "volato-vite-react", "volato-node"]) {
    cpSync(join(skillRoot, name), join(fixtureRoot, ".agents", "skills", name), {
      recursive: true,
    });
  }

  const wrapper = `#!/usr/bin/env node\nimport { appendFileSync } from "node:fs";\nimport { spawnSync } from "node:child_process";\n\nconst args = process.argv.slice(2);\nconst result = spawnSync(process.execPath, [process.env.VOLATO_REAL_CLI, ...args], { stdio: "inherit", env: process.env });\nconst status = result.status ?? 1;\nappendFileSync(process.env.VOLATO_EVAL_LOG, JSON.stringify({ args, status }) + "\\n");\nprocess.exit(status);\n`;
  writeFileSync(join(fixtureRoot, "bin", "volato"), wrapper);
  chmodSync(join(fixtureRoot, "bin", "volato"), 0o755);

  const mockApi = `import { appendFileSync, writeFileSync } from "node:fs";\nimport { createServer } from "node:http";\n\nconst projectId = ${JSON.stringify(projectId)};\nconst server = createServer((request, response) => {\n  appendFileSync(process.env.VOLATO_EVAL_REQUEST_LOG, JSON.stringify({ method: request.method, url: request.url }) + "\\n");\n  const origin = "http://public@127.0.0.1:" + server.address().port;\n  let status = 200;\n  let data = {};\n  if (request.method === "GET" && request.url === "/v1/projects/" + projectId + "/setup") {\n    data = { projectId, projectName: "Vite Node Setup Eval", dsn: origin + "/api/ingest", ingestToken: "eval-server-secret" };\n  } else if (request.method === "POST" && request.url === "/v1/projects/" + projectId + "/linked") {\n    data = { projectId, linked: true };\n  } else if (request.method === "POST" && request.url.startsWith("/v1/projects/" + projectId + "/integrations/")) {\n    data = { installed: true };\n  } else if (request.method === "GET" && request.url.startsWith("/v1/errors?")) {\n    data = { kind: "ok", rows: [], nextCursor: null, query: {} };\n  } else if (request.method === "POST" && request.url === "/api/sourcemaps") {\n    data = { uploaded: true };\n  } else if (request.method === "POST" && request.url === "/api/ingest") {\n    status = 202;\n    data = { accepted: true };\n  } else {\n    status = 404;\n  }\n  request.resume();\n  response.writeHead(status, { "content-type": "application/json" });\n  response.end(JSON.stringify(status >= 200 && status < 300 ? { data } : { error: "not_found" }));\n});\nserver.listen(0, "127.0.0.1", () => writeFileSync(process.env.VOLATO_EVAL_PORT_FILE, String(server.address().port)));\n`;
  writeFileSync(join(fixtureRoot, "mock-api.mjs"), mockApi);

  run("git", ["init", "--quiet"]);
  run("git", ["config", "user.email", "eval@volato.dev"]);
  run("git", ["config", "user.name", "Volato Eval"]);
  run("git", ["add", "."]);
  run("git", ["commit", "--quiet", "-m", "feat: add Vite React Express fixture"]);
}

function readJsonLines(path) {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
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
      // Non-JSON stderr remains useful evidence but has no usage object.
    }
  }
  return result;
}

let keepFixture = process.env.VOLATO_KEEP_EVAL === "1";
let mockApiProcess;
let packagedCli;

try {
  packagedCli = installPackagedCli();
  writeFixture();
  mockApiProcess = spawn(process.execPath, [join(fixtureRoot, "mock-api.mjs")], {
    cwd: fixtureRoot,
    stdio: "ignore",
    env: {
      ...process.env,
      VOLATO_EVAL_PORT_FILE: serverPortFile,
      VOLATO_EVAL_REQUEST_LOG: requestLog,
    },
  });
  waitForFile(serverPortFile);
  const port = readFileSync(serverPortFile, "utf8").trim();
  const startedAt = Date.now();
  const evaluation = await runAgent(
    [
      "exec",
      "--ephemeral",
      "--ignore-user-config",
      "--sandbox",
      "workspace-write",
      "--json",
      "-c",
      'shell_environment_policy.inherit="all"',
      "-c",
      "sandbox_workspace_write.network_access=true",
      "-C",
      fixtureRoot,
      "Install Volato in this project.",
    ],
    {
      timeout: 7 * 60_000,
      env: {
        PATH: `${join(fixtureRoot, "bin")}:${process.env.PATH ?? ""}`,
        VOLATO_API_URL: `http://127.0.0.1:${port}`,
        VOLATO_EVAL_LOG: commandLog,
        VOLATO_REAL_CLI: realCli,
        VOLATO_RELEASE: "4444444444444444444444444444444444444444",
        VOLATO_TOKEN: "eval-workspace-token",
      },
    },
  );
  const wallClockMs = Date.now() - startedAt;
  const trace = `${evaluation.stdout}\n${evaluation.stderr}`;
  writeFileSync(join(fixtureRoot, ".volato-eval-trace.jsonl"), trace);

  const commands = readJsonLines(commandLog);
  const requests = readJsonLines(requestLog);
  const selectedSetupSkill = trace.includes("volato-setup/SKILL.md");
  const selectedBrowserSkill = trace.includes("volato-vite-react/SKILL.md");
  const selectedNodeSkill = trace.includes("volato-node/SKILL.md");
  const calledInit = commands.some(
    ({ args }) => args[0] === "init" && args.includes("--project") && args.includes(projectId),
  );
  const calledErrorsInit = commands.some(
    ({ args }) => args[0] === "errors" && args[1] === "init",
  );
  const successfulErrorsInit = commands.findLastIndex(
    ({ args, status }) =>
      args[0] === "errors" && args[1] === "init" && status === 0,
  );
  const unrecoveredVolatoFailures = commands.filter(
    ({ args, status }, index) =>
      status !== 0 &&
      !(
        args[0] === "errors" &&
        args[1] === "init" &&
        index < successfulErrorsInit
      ),
  );
  const reportedBrowser = requests.some(
    ({ method, url }) => method === "POST" && url.endsWith("/integrations/errors-vite-react"),
  );
  const reportedNode = requests.some(
    ({ method, url }) => method === "POST" && url.endsWith("/integrations/errors-node"),
  );
  const sourcemapUploaded = requests.some(
    ({ method, url }) => method === "POST" && url === "/api/sourcemaps",
  );
  const runtimeEventDelivered = requests.some(
    ({ method, url }) => method === "POST" && url === "/api/ingest",
  );
  const manifest = JSON.parse(
    readFileSync(join(fixtureRoot, ".volato", "manifest.json"), "utf8"),
  );
  const packageJson = JSON.parse(readFileSync(join(fixtureRoot, "package.json"), "utf8"));
  const sourceSurface = ["src/main.tsx", "src/server.ts", "vite.config.ts"]
    .map((path) => readFileSync(join(fixtureRoot, path), "utf8"))
    .join("\n");
  const tests = run("npm", ["test"], { allowFailure: true });
  const result = {
    prompt: "Install Volato in this project.",
    stack: "Vite + React + Node.js + Express",
    cliArtifact: "npm pack",
    cliVersion: packagedCli.version,
    agentExitCode: evaluation.status,
    selectedSetupSkill,
    selectedBrowserSkill,
    selectedNodeSkill,
    calledInit,
    calledErrorsInit,
    unrecoveredVolatoFailures,
    generatedBrowser: Boolean(manifest.integrations?.["errors-vite-react"]),
    generatedNode: Boolean(manifest.integrations?.["errors-node"]),
    reportedBrowser,
    reportedNode,
    sourcemapUploaded,
    runtimeEventDelivered,
    buildPassed: existsSync(join(fixtureRoot, ".volato-eval-build.json")),
    testsPassed: tests.status === 0,
    runtimeDependencyAdded: Object.keys(packageJson.dependencies ?? {}).some((name) =>
      name.toLowerCase().includes("volato"),
    ),
    secretInApplicationSource: sourceSurface.includes("eval-server-secret"),
    metrics: {
      wallClockMs,
      volatoCalls: commands.length,
      agentTraceBytes: Buffer.byteLength(trace),
      usage: usageFromTrace(trace),
    },
    commands,
    requests,
  };
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);

  assert(evaluation.status === 0, "the fresh coding agent did not complete");
  assert(selectedSetupSkill, "the agent did not select volato-setup");
  assert(selectedBrowserSkill, "the agent did not inspect volato-vite-react");
  assert(selectedNodeSkill, "the agent did not inspect volato-node");
  assert(calledInit, "the agent did not link the selected Volato project");
  assert(calledErrorsInit, "the agent did not invoke Errors setup");
  assert(
    unrecoveredVolatoFailures.length === 0,
    "an agent-invented Volato command failed without a recovered manual setup outcome",
  );
  assert(result.generatedBrowser, "the browser adapter was not generated");
  assert(result.generatedNode, "the Node adapter was not generated");
  assert(reportedBrowser, "the browser integration was not reported");
  assert(reportedNode, "the Node integration was not reported");
  assert(sourcemapUploaded, "the production build uploaded no sourcemap");
  assert(runtimeEventDelivered, "the generated runtime delivered no event");
  assert(result.buildPassed, "the agent did not run the fixture production build");
  assert(result.testsPassed, "the generated composition did not pass tests");
  assert(!result.runtimeDependencyAdded, "setup added a Volato runtime dependency");
  assert(!result.secretInApplicationSource, "setup exposed the server token in application source");
} catch (error) {
  keepFixture = true;
  process.stderr.write(
    `${error instanceof Error ? error.stack : String(error)}\nFixture kept at ${fixtureRoot}\n`,
  );
  process.exitCode = 1;
} finally {
  mockApiProcess?.kill("SIGTERM");
  if (!keepFixture) rmSync(fixtureRoot, { recursive: true, force: true });
  rmSync(cliInstallRoot, { recursive: true, force: true });
}
