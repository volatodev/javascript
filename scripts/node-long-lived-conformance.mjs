import { execFileSync, spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { TraceMap, originalPositionFor } from "@jridgewell/trace-mapping";
import { runtimeMatrix } from "./errors-runtime-matrix.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const scratch = mkdtempSync(join(tmpdir(), "volato-node-long-lived-"));
const projectId = "00000000-0000-4000-8000-0000000001c0";
const authToken = "node-conformance-auth";
const ingestToken = "node-conformance-ingest";
const cliSpec = process.env.VOLATO_CLI_SPEC;
const cells = runtimeMatrix.cells.filter(
  (cell) => cell.family === "node-long-lived",
);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function run(command, args, options = {}) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? repositoryRoot,
      env: { ...process.env, ...options.env, NO_COLOR: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      rejectRun(
        new Error(`${command} ${args.join(" ")} timed out\n${stdout}\n${stderr}`),
      );
    }, options.timeoutMs ?? 30_000);
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.once("error", (error) => {
      clearTimeout(timeout);
      rejectRun(error);
    });
    child.once("close", (status) => {
      clearTimeout(timeout);
      if (status !== 0 && !options.allowFailure) {
        rejectRun(
          new Error(
            `${command} ${args.join(" ")} failed (${status})\n${stdout}\n${stderr}`,
          ),
        );
        return;
      }
      resolveRun({ stdout, stderr, status });
    });
  });
}

function installPackagedCli() {
  const host = join(scratch, "cli-host");
  mkdirSync(host, { recursive: true });
  writeFileSync(join(host, "package.json"), '{"name":"cli-host","private":true}\n');
  let spec = cliSpec;
  if (!spec || spec === "pack") {
    const packDir = join(scratch, "pack");
    mkdirSync(packDir, { recursive: true });
    execFileSync(
      "npm",
      ["pack", "--pack-destination", packDir, "--cache", join(scratch, "npm")],
      { cwd: join(repositoryRoot, "packages", "cli"), stdio: "pipe" },
    );
    const archive = readdirSync(packDir).find((name) => name.endsWith(".tgz"));
    assert(archive, "npm pack produced no CLI archive");
    spec = join(packDir, archive);
  }
  execFileSync(
    "npm",
    ["install", "--no-audit", "--no-fund", "--cache", join(scratch, "npm"), spec],
    { cwd: host, stdio: "pipe" },
  );
  return join(host, "node_modules", ".bin", "volato");
}

function installExactNode(version) {
  const root = join(scratch, `node-${version}`);
  mkdirSync(root, { recursive: true });
  writeFileSync(
    join(root, "package.json"),
    `${JSON.stringify({ private: true, dependencies: { node: version } })}\n`,
  );
  execFileSync(
    "npm",
    ["install", "--no-audit", "--no-fund", "--cache", join(scratch, "npm")],
    { cwd: root, stdio: "pipe" },
  );
  const binary = join(root, "node_modules", "node", "bin", "node");
  assert(existsSync(binary), `Node ${version} binary was not installed`);
  assert(
    execFileSync(binary, ["--version"], { encoding: "utf8" }).trim() ===
      `v${version}`,
    `Node binary does not report ${version}`,
  );
  return binary;
}

function installTypeScript() {
  const root = join(scratch, "typescript");
  mkdirSync(root, { recursive: true });
  writeFileSync(
    join(root, "package.json"),
    `${JSON.stringify({
      private: true,
      dependencies: {
        typescript: runtimeMatrix.versions.typescript[0],
        "@types/node": "24.12.2",
      },
    })}\n`,
  );
  execFileSync(
    "npm",
    ["install", "--no-audit", "--no-fund", "--cache", join(scratch, "npm")],
    { cwd: root, stdio: "pipe" },
  );
  const compiler = join(root, "node_modules", "typescript", "bin", "tsc");
  assert(existsSync(compiler), "TypeScript compiler was not installed");
  return {
    compiler,
    nodeTypes: join(root, "node_modules", "@types", "node"),
    undiciTypes: join(root, "node_modules", "undici-types"),
  };
}

function allFiles(root) {
  if (!existsSync(root)) return [];
  return readdirSync(root).flatMap((name) => {
    const path = join(root, name);
    return statSync(path).isDirectory() ? allFiles(path) : [path];
  });
}

function entryRelativePath(processShape, language) {
  const extension = language === "ts" ? "ts" : "js";
  if (processShape === "script") return `src/index.${extension}`;
  return `src/${processShape}.${extension}`;
}

function fixtureSource(cell) {
  const moduleImport =
    cell.module === "esm"
      ? 'import { captureNodeException } from "./volato-node/node.js";'
      : cell.language === "js"
        ? 'const { captureNodeException } = require("./volato-node/node.cjs");'
        : 'const { captureNodeException } = require("./volato-node/node.js");';
  const hold =
    cell.processShape === "server"
      ? "const serverHeartbeat = setInterval(() => {}, 1_000);"
      : "const serverHeartbeat = undefined;";
  const surfaceParameter = cell.language === "ts" ? "surface: string" : "surface";
  const errorDeclaration =
    cell.language === "ts"
      ? `const error = new Error(surface + " ${cell.id}") as Error & {
    privateEmail?: string;
    privateToken?: string;
  };`
      : `const error = new Error(surface + " ${cell.id}");`;
  return `${moduleImport}
${hold}
const mode = process.argv[2] ?? "success";
function causalError(${surfaceParameter}) {
  ${errorDeclaration}
  error.privateEmail = "private@example.com";
  error.privateToken = "node-private-token";
  return error;
}
async function runFixture() {
  if (mode === "manual") {
    await captureNodeException(causalError("manual"));
  } else if (mode === "fatal") {
    setTimeout(() => { throw causalError("fatal"); }, 20);
    return;
  } else if (mode === "rejection") {
    setTimeout(() => { void Promise.reject(causalError("rejection")); }, 20);
    return;
  }
  if (serverHeartbeat) clearInterval(serverHeartbeat);
}
void runFixture();
`;
}

function writeFixture(root, cell, tooling) {
  mkdirSync(join(root, "src"), { recursive: true });
  const isTypeScript = cell.language === "ts";
  const packageJson = {
    name: cell.id,
    private: true,
    type: cell.module === "esm" ? "module" : "commonjs",
    scripts: isTypeScript ? { build: "tsc --sourceMap" } : {},
    ...(isTypeScript
      ? { devDependencies: { typescript: runtimeMatrix.versions.typescript[0] } }
      : {}),
  };
  writeFileSync(
    join(root, "package.json"),
    `${JSON.stringify(packageJson, null, 2)}\n`,
  );
  const entry = entryRelativePath(cell.processShape, cell.language);
  const source = fixtureSource(cell);
  writeFileSync(join(root, entry), source);
  if (isTypeScript) {
    writeFileSync(
      join(root, "tsconfig.json"),
      `${JSON.stringify(
        {
          compilerOptions: {
            target: "ES2022",
            module: cell.module === "esm" ? "NodeNext" : "CommonJS",
            moduleResolution: cell.module === "esm" ? "NodeNext" : "Node",
            rootDir: "src",
            outDir: "dist",
            sourceMap: true,
            strict: true,
            skipLibCheck: true,
            lib: ["ES2022", "DOM"],
          },
          include: ["src"],
        },
        null,
        2,
      )}\n`,
    );
    mkdirSync(join(root, "node_modules", ".bin"), { recursive: true });
    symlinkSync(tooling.compiler, join(root, "node_modules", ".bin", "tsc"));
    mkdirSync(join(root, "node_modules", "@types"), { recursive: true });
    symlinkSync(
      tooling.nodeTypes,
      join(root, "node_modules", "@types", "node"),
      "dir",
    );
    symlinkSync(
      tooling.undiciTypes,
      join(root, "node_modules", "undici-types"),
      "dir",
    );
  }
  writeFileSync(join(root, ".gitignore"), "node_modules\ndist\n.env*.local\n");
  return { entry, source };
}

function sourceLine(source) {
  return source.split("\n").findIndex((line) => line.includes("new Error(surface")) + 1;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^$()|[\]\\{}]/g, "\\$&");
}

function assertSourceResolution(cell, fixture, entry, source, event) {
  const causalLine = sourceLine(source);
  assert(causalLine > 0, `${cell.id} has no causal source line`);
  const outputPath =
    cell.language === "ts"
      ? join(fixture, "dist", basename(entry).replace(/\.ts$/, ".js"))
      : join(fixture, entry);
  const frame = new RegExp(
    `${escapeRegExp(outputPath)}:(\\d+):(\\d+)`,
  ).exec(event.stack ?? "");
  assert(frame, `${cell.id} stack did not contain ${outputPath}: ${event.stack}`);
  if (cell.language === "js") {
    assert(
      Number(frame[1]) === causalLine,
      `${cell.id} direct frame resolved to line ${frame[1]}, expected ${causalLine}`,
    );
    return;
  }
  const mapPath = `${outputPath}.map`;
  const map = JSON.parse(readFileSync(mapPath, "utf8"));
  assert(!("sourcesContent" in map), `${cell.id} map retained sourcesContent`);
  const original = originalPositionFor(new TraceMap(map), {
    line: Number(frame[1]),
    column: Number(frame[2]) - 1,
  });
  assert(
    original.source?.replaceAll("\\", "/").endsWith(entry) &&
      original.line === causalLine,
    `${cell.id} resolved to ${original.source}:${original.line}, expected ${entry}:${causalLine}`,
  );
}

const state = { events: [], maps: [], integrations: [] };
const api = createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  const setup = url.pathname.match(/^\/v1\/projects\/([0-9a-f-]+)\/setup$/);
  if (req.method === "GET" && setup) {
    if (req.headers.authorization !== `Bearer ${authToken}`) {
      res.writeHead(401).end();
      return;
    }
    const address = api.address();
    const origin = `http://127.0.0.1:${address.port}`;
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        data: {
          projectId: setup[1],
          projectName: "Node matrix conformance",
          dsn: `http://public@127.0.0.1:${address.port}/${setup[1]}`,
          ingestToken,
        },
      }),
    );
    return;
  }
  if (req.method === "POST" && /^\/v1\/projects\/[0-9a-f-]+\/linked$/.test(url.pathname)) {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ data: { projectId, linked: true } }));
    return;
  }
  const integration = url.pathname.match(
    /^\/v1\/projects\/[0-9a-f-]+\/integrations\/(errors-[a-z-]+)$/,
  );
  if (req.method === "POST" && integration) {
    state.integrations.push(integration[1]);
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ data: { recorded: true } }));
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/ingest") {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      state.events.push(JSON.parse(body));
      res.writeHead(202, { "content-type": "application/json" });
      res.end(JSON.stringify({ accepted: true }));
    });
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/sourcemaps") {
    let body = Buffer.alloc(0);
    req.on("data", (chunk) => {
      body = Buffer.concat([body, chunk]);
    });
    req.on("end", () => {
      if (req.headers.authorization !== `Bearer ${ingestToken}`) {
        res.writeHead(401).end();
        return;
      }
      state.maps.push(body.toString("utf8"));
      res.writeHead(201, { "content-type": "application/json" });
      res.end(JSON.stringify({ stored: true }));
    });
    return;
  }
  res.writeHead(404).end();
});

async function conformCell(cell, context) {
  const fixture = join(scratch, "fixtures", cell.id);
  const { entry } = writeFixture(fixture, cell, context.tooling);
  const integrationCount = state.integrations.length;
  await run(context.cli, ["init", "--project", projectId, "--yes"], {
    cwd: fixture,
    env: { VOLATO_API_URL: context.apiOrigin, VOLATO_TOKEN: authToken },
  });
  const setup = await run(context.cli, ["errors", "init", "--yes"], {
    cwd: fixture,
    env: { VOLATO_API_URL: context.apiOrigin, VOLATO_TOKEN: authToken },
  });
  assert(
    !setup.stdout.includes("manual") &&
      state.integrations.slice(integrationCount).includes("errors-node"),
    `${cell.id} did not reach ready Node setup:\n${setup.stdout}\n${setup.stderr}`,
  );
  assert(
    !readFileSync(join(fixture, "package.json"), "utf8").includes("@volatodev"),
    `${cell.id} gained a Volato runtime dependency`,
  );
  const integratedSource = readFileSync(join(fixture, entry), "utf8");

  const release = `conformance-${cell.id}`;
  const mapsBefore = state.maps.length;
  if (cell.language === "ts") {
    await run("npm", ["run", "build"], {
      cwd: fixture,
      env: {
        VOLATO_DSN: context.dsn,
        VOLATO_INGEST_TOKEN: ingestToken,
        VOLATO_RELEASE: release,
      },
    });
    const cellMaps = state.maps.slice(mapsBefore);
    assert(cellMaps.length >= 2, `${cell.id} did not upload its private maps`);
    assert(
      cellMaps.every((body) => !body.includes("sourcesContent")),
      `${cell.id} uploaded sourcesContent`,
    );
    assert(
      allFiles(join(fixture, "dist"))
        .filter((path) => path.endsWith(".map"))
        .every((path) => !readFileSync(path, "utf8").includes("sourcesContent")),
      `${cell.id} retained sourcesContent in a build map`,
    );
  } else {
    assert(state.maps.length === mapsBefore, `${cell.id} unexpectedly uploaded a map`);
  }

  const binary = context.nodeBinaries[cell.node];
  const executable =
    cell.language === "ts"
      ? join(fixture, "dist", basename(entry).replace(/\.ts$/, ".js"))
      : join(fixture, entry);
  const runtimeEnv = {
    VOLATO_DSN: context.dsn,
    VOLATO_RELEASE: release,
    NODE_ENV: "production",
  };
  const eventsBeforeSuccess = state.events.length;
  const success = await run(binary, [executable, "success"], {
    cwd: fixture,
    env: runtimeEnv,
  });
  assert(success.status === 0, `${cell.id} changed successful exit semantics`);
  assert(
    state.events.length === eventsBeforeSuccess,
    `${cell.id} emitted an event on success`,
  );

  for (const [mode, capturedVia, shouldFail] of [
    ["manual", "manual", false],
    ["fatal", "uncaught_exception", true],
    ["rejection", "unhandled_rejection", true],
  ]) {
    const before = state.events.length;
    const result = await run(binary, [executable, mode], {
      cwd: fixture,
      env: runtimeEnv,
      allowFailure: shouldFail,
    });
    assert(
      shouldFail ? result.status !== 0 : result.status === 0,
      `${cell.id} ${mode} exit status was ${result.status}`,
    );
    const events = state.events.slice(before);
    assert(events.length === 1, `${cell.id} ${mode} emitted ${events.length} events`);
    const event = events[0];
    assert(
      event.runtime === "node" &&
        event.capturedVia === capturedVia &&
        event.release === release &&
        event.message === `${mode} ${cell.id}`,
      `${cell.id} ${mode} event contract failed: ${JSON.stringify(event)}`,
    );
    assert(
      !JSON.stringify(event).includes("private@example.com") &&
        !JSON.stringify(event).includes("node-private-token"),
      `${cell.id} ${mode} leaked arbitrary Error fields`,
    );
    assertSourceResolution(cell, fixture, entry, integratedSource, event);
  }
  process.stdout.write(`✓ ${cell.id}\n`);
}

try {
  assert(cells.length === 24, `expected 24 Node cells, got ${cells.length}`);
  await new Promise((resolveListen, rejectListen) => {
    api.once("error", rejectListen);
    api.listen(0, "127.0.0.1", resolveListen);
  });
  const address = api.address();
  assert(address && typeof address === "object", "mock API did not bind");
  const apiOrigin = `http://127.0.0.1:${address.port}`;
  const dsn = `http://public@127.0.0.1:${address.port}/${projectId}`;
  const cli = installPackagedCli();
  const tooling = installTypeScript();
  const nodeBinaries = Object.fromEntries(
    runtimeMatrix.versions.node.map((version) => [version, installExactNode(version)]),
  );
  for (const cell of cells) {
    await conformCell(cell, { apiOrigin, dsn, cli, tooling, nodeBinaries });
  }
  process.stdout.write(
    `✓ ${cells.length} long-lived Node cells passed setup, build/direct source, capture, privacy, lifecycle, exact source resolution, and exact-version execution\n`,
  );
} finally {
  await new Promise((resolveClose) => api.close(resolveClose));
  rmSync(scratch, { recursive: true, force: true });
}
