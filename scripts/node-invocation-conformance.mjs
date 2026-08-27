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
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { TraceMap, originalPositionFor } from "@jridgewell/trace-mapping";
import { runtimeMatrix } from "./errors-runtime-matrix.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const scratch = mkdtempSync(join(tmpdir(), "volato-node-invocation-"));
const projectId = "00000000-0000-4000-8000-0000000001d0";
const authToken = "invocation-conformance-auth";
const ingestToken = "invocation-conformance-ingest";
const cliSpec = process.env.VOLATO_CLI_SPEC;
const cells = runtimeMatrix.cells.filter(
  (cell) => cell.family === "node-invocation",
);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function run(command, args, options = {}) {
  return new Promise((resolveRun, rejectRun) => {
    const startedAt = Date.now();
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
      resolveRun({ stdout, stderr, status, elapsedMs: Date.now() - startedAt });
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
  return {
    compiler: join(root, "node_modules", "typescript", "bin", "tsc"),
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

function exportedHandler(cell, parameters, body) {
  if (cell.language === "js" && cell.module === "cjs") {
    return `exports.handler = async (${parameters}) => {\n${body}\n};`;
  }
  return `export async function handler(${parameters}) {\n${body}\n}`;
}

function fixtureSource(cell) {
  const typed = cell.language === "ts" ? ": any" : "";
  const errorCast = cell.language === "ts" ? " as any" : "";
  const receiverCheck =
    cell.language === "js" && cell.module === "cjs"
      ? ""
      : `  if (this?.marker !== "receiver") throw new Error("receiver semantics changed");\n`;
  const causal = `function causalError(surface${typed}) {
  const error = new Error(surface + " ${cell.id}")${errorCast};
  error.privateEmail = "private@example.com";
  error.privateToken = "invocation-private-token";
  return error;
}`;
  if (cell.handlerShape === "node-http-handler") {
    return `${causal}
${exportedHandler(
  cell,
  `req${typed}, res${typed}`,
  `${receiverCheck}  if (req.surface === "success") {
    res.statusCode = 204;
    res.end();
    return req.returnValue;
  }
  res.statusCode = 503;
  const failure = causalError(req.surface);
  req.observedFailure = failure;
  if (req.surface === "rejection") return Promise.reject(failure);
  throw failure;`,
) }
`;
  }
  return `${causal}
${exportedHandler(
  cell,
  `input${typed}`,
  `${receiverCheck}  if (input.surface === "success") return input.returnValue;
  const failure = causalError(input.surface);
  input.observedFailure = failure;
  if (input.surface === "rejection") return Promise.reject(failure);
  throw failure;`,
) }
`;
}

function runnerSource(cell) {
  const cjs = cell.module === "cjs";
  const load = cjs
    ? 'const loaded = require("./handler.js");'
    : 'const loaded = await import("./handler.js");';
  const http = cell.handlerShape === "node-http-handler";
  const requestId = cell.language === "ts" ? 'id: `request-${index}`,' : "";
  return `function assertFixture(condition, message) {
  if (!condition) throw new Error(message);
}

async function main() {
  const beforeUncaught = process.listenerCount("uncaughtException");
  const beforeRejection = process.listenerCount("unhandledRejection");
  ${load}
  const handler = loaded.handler;
  assertFixture(typeof handler === "function", "handler export missing");
  assertFixture(process.listenerCount("uncaughtException") === beforeUncaught, "uncaughtException hook installed");
  assertFixture(process.listenerCount("unhandledRejection") === beforeRejection, "unhandledRejection hook installed");

  async function invoke(surface, index) {
    const returnValue = { surface, index, exact: true };
    const input = {
      surface,
      returnValue,
      observedFailure: undefined,
      privateInput: "generic-private-input",
    };
    const request = {
      surface,
      returnValue,
      observedFailure: undefined,
      method: "POST",
      url: "/customers/private-user@example.com/orders/secret-42?token=hidden",
      ${requestId}
      headers: {
        "x-request-id": "header-request-" + index,
        authorization: "Bearer private-token",
      },
      body: { card: "4242424242424242" },
      cookies: { session: "private-cookie" },
    };
    const response = { statusCode: 200, ended: false, end() { this.ended = true; } };
    const carrier = ${http ? "request" : "input"};
    const args = ${http ? "[request, response]" : "[input]"};
    try {
      const result = await handler.apply({ marker: "receiver" }, args);
      assertFixture(surface === "success", surface + " was swallowed");
      assertFixture(result === returnValue, "return identity changed");
      ${http ? 'assertFixture(response.statusCode === 204 && response.ended, "HTTP success semantics changed");' : ""}
    } catch (failure) {
      assertFixture(surface !== "success", "success unexpectedly failed");
      assertFixture(failure === carrier.observedFailure, "original failure identity changed");
      ${http ? 'assertFixture(response.statusCode === 503, "HTTP error status changed");' : ""}
    }
  }

  const mode = process.argv[2] ?? "success";
  if (mode === "success") {
    await invoke("success", 0);
  } else if (mode === "cold-throw") {
    await invoke("throw", 1);
  } else if (mode === "cold-rejection") {
    await invoke("rejection", 2);
  } else if (mode === "warm") {
    await invoke("success", 3);
    await invoke("throw", 4);
    await invoke("rejection", 5);
  } else if (mode === "concurrent") {
    await invoke("success", 6);
    await Promise.all([invoke("throw", 7), invoke("rejection", 8)]);
  } else {
    throw new Error("unknown mode: " + mode);
  }
  process.stdout.write(JSON.stringify({ ok: true, mode }));
}

main().catch((error) => {
  console.error(error?.stack ?? error);
  process.exitCode = 1;
});
`;
}

function writeFixture(root, cell, tooling) {
  mkdirSync(join(root, "src"), { recursive: true });
  const isTypeScript = cell.language === "ts";
  writeFileSync(
    join(root, "package.json"),
    `${JSON.stringify(
      {
        name: cell.id,
        private: true,
        type: cell.module === "esm" ? "module" : "commonjs",
        scripts: isTypeScript ? { build: "tsc --sourceMap" } : {},
        ...(isTypeScript
          ? { devDependencies: { typescript: runtimeMatrix.versions.typescript[0] } }
          : {}),
      },
      null,
      2,
    )}\n`,
  );
  const extension = isTypeScript ? "ts" : "js";
  const entry = `src/handler.${extension}`;
  writeFileSync(join(root, entry), fixtureSource(cell));
  writeFileSync(join(root, `src/runner.${extension}`), runnerSource(cell));
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
            strict: false,
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
    symlinkSync(tooling.nodeTypes, join(root, "node_modules", "@types", "node"), "dir");
    symlinkSync(tooling.undiciTypes, join(root, "node_modules", "undici-types"), "dir");
  }
  writeFileSync(join(root, ".gitignore"), "node_modules\ndist\n.env*.local\n");
  return { entry };
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
  const frame = new RegExp(`${escapeRegExp(outputPath)}:(\\d+):(\\d+)`).exec(
    event.stack ?? "",
  );
  assert(frame, `${cell.id} stack did not contain ${outputPath}: ${event.stack}`);
  if (cell.language === "js") {
    assert(
      Number(frame[1]) === causalLine,
      `${cell.id} direct frame resolved to line ${frame[1]}, expected ${causalLine}`,
    );
    return;
  }
  const map = JSON.parse(readFileSync(`${outputPath}.map`, "utf8"));
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

const state = {
  events: [],
  maps: [],
  integrations: [],
  delayNextIngest: false,
};

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
          projectName: "Node invocation conformance",
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
      if (state.delayNextIngest) {
        state.delayNextIngest = false;
        const timer = setTimeout(() => {
          if (!res.writableEnded) res.writeHead(202).end();
        }, 5_000);
        timer.unref();
        return;
      }
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

function expectedMessages(cell, mode) {
  if (mode === "success") return [];
  if (mode === "cold-throw") return [`throw ${cell.id}`];
  if (mode === "cold-rejection") return [`rejection ${cell.id}`];
  return [`throw ${cell.id}`, `rejection ${cell.id}`];
}

async function runMode(cell, fixture, executable, source, context, mode, options = {}) {
  const before = state.events.length;
  if (options.delayIngest) state.delayNextIngest = true;
  const result = await run(context.nodeBinaries[cell.node], [executable, mode], {
    cwd: fixture,
    env: options.withoutDsn
      ? { NODE_ENV: "production", VOLATO_DSN: "", VOLATO_RELEASE: context.release }
      : {
          NODE_ENV: "production",
          VOLATO_DSN: context.dsn,
          VOLATO_RELEASE: context.release,
        },
  });
  assert(result.status === 0, `${cell.id} ${mode} changed caller semantics`);
  assert(result.stdout.includes('"ok":true'), `${cell.id} ${mode} runner did not finish`);
  const expected = options.withoutDsn ? [] : expectedMessages(cell, mode);
  const events = state.events.slice(before);
  assert(
    events.length === expected.length,
    `${cell.id} ${mode} emitted ${events.length} events, expected ${expected.length}`,
  );
  if (options.withoutDsn) {
    assert(
      result.stderr.includes("VOLATO_DSN is missing"),
      `${cell.id} missing configuration was silent`,
    );
    assert(result.elapsedMs < 500, `${cell.id} missing configuration was not bounded`);
    return result;
  }
  if (options.delayIngest) {
    assert(
      result.elapsedMs < 2_800,
      `${cell.id} invocation flush exceeded its 2000ms bound (${result.elapsedMs}ms)`,
    );
  }
  const messages = events.map((event) => event.message).sort();
  assert(
    JSON.stringify(messages) === JSON.stringify([...expected].sort()),
    `${cell.id} ${mode} captured unexpected messages: ${JSON.stringify(messages)}`,
  );
  for (const event of events) {
    assert(
      event.runtime === "node" &&
        event.capturedVia === "invocation" &&
        event.release === context.release &&
        event.contexts?.function?.name === "handler",
      `${cell.id} ${mode} event contract failed: ${JSON.stringify(event)}`,
    );
    const wire = JSON.stringify(event);
    for (const secret of [
      "private@example.com",
      "invocation-private-token",
      "private-user@example.com",
      "secret-42",
      "token=hidden",
      "generic-private-input",
      "private-token",
      "4242424242424242",
      "private-cookie",
    ]) {
      assert(!wire.includes(secret), `${cell.id} leaked ${secret}`);
    }
    if (cell.handlerShape === "node-http-handler") {
      assert(
        event.method === "POST" &&
          event.route === "/:segment/:segment/:segment/:segment" &&
          event.status === 503 &&
          /^request-|^header-request-/.test(event.requestId),
        `${cell.id} HTTP context was not normalized: ${wire}`,
      );
    } else {
      assert(
        event.method === undefined &&
          event.route === undefined &&
          event.status === undefined &&
          event.requestId === undefined,
        `${cell.id} generic handler inspected HTTP arguments`,
      );
    }
    assertSourceResolution(cell, fixture, `src/handler.${cell.language === "ts" ? "ts" : "js"}`, source, event);
  }
  return result;
}

async function conformCell(cell, context, index) {
  const fixture = join(scratch, "fixtures", cell.id);
  const { entry } = writeFixture(fixture, cell, context.tooling);
  await run(context.cli, ["init", "--project", projectId, "--yes"], {
    cwd: fixture,
    env: { VOLATO_API_URL: context.apiOrigin, VOLATO_TOKEN: authToken },
  });
  const integrationsBefore = state.integrations.length;
  const setup = await run(context.cli, ["errors", "init", "--yes"], {
    cwd: fixture,
    env: { VOLATO_API_URL: context.apiOrigin, VOLATO_TOKEN: authToken },
  });
  assert(
    !setup.stdout.includes("manual") &&
      state.integrations
        .slice(integrationsBefore)
        .includes("errors-node-invocation"),
    `${cell.id} did not reach ready invocation setup:\n${setup.stdout}\n${setup.stderr}`,
  );
  const rerun = await run(context.cli, ["errors", "init", "--yes"], {
    cwd: fixture,
    env: { VOLATO_API_URL: context.apiOrigin, VOLATO_TOKEN: authToken },
  });
  assert(
    !rerun.stdout.includes("manual") &&
      readFileSync(join(fixture, entry), "utf8").match(/withVolatoInvocation\(/g)?.length === 1,
    `${cell.id} setup did not converge:\n${rerun.stdout}\n${rerun.stderr}`,
  );
  const packageSource = readFileSync(join(fixture, "package.json"), "utf8");
  assert(!packageSource.includes("@volatodev"), `${cell.id} gained a runtime dependency`);
  const integratedSource = readFileSync(join(fixture, entry), "utf8");
  const emitted = allFiles(join(fixture, "src", "volato-invocation"))
    .map((path) => readFileSync(path, "utf8"))
    .join("\n");
  assert(
    !/(?:AWS_|VERCEL|NETLIFY|GOOGLE_CLOUD|AZURE_FUNCTION)/i.test(
      `${integratedSource}\n${emitted}`,
    ),
    `${cell.id} selected a provider-specific preset`,
  );

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
    const uploaded = state.maps.slice(mapsBefore);
    assert(uploaded.length >= 3, `${cell.id} did not upload its invocation maps`);
    assert(
      uploaded.every((body) => !body.includes("sourcesContent")),
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

  const executable =
    cell.language === "ts"
      ? join(fixture, "dist", "runner.js")
      : join(fixture, "src", "runner.js");
  const runContext = { ...context, release };
  await runMode(cell, fixture, executable, integratedSource, runContext, "success");
  await runMode(cell, fixture, executable, integratedSource, runContext, "cold-throw", {
    delayIngest: index === 0,
  });
  await runMode(cell, fixture, executable, integratedSource, runContext, "cold-rejection");
  await runMode(cell, fixture, executable, integratedSource, runContext, "warm");
  await runMode(cell, fixture, executable, integratedSource, runContext, "concurrent");
  if (index === 0) {
    await runMode(cell, fixture, executable, integratedSource, runContext, "cold-throw", {
      withoutDsn: true,
    });
  }
  process.stdout.write(`✓ ${cell.id}\n`);
}

async function assertRefusals(cli) {
  for (const refusal of [
    {
      id: "callback",
      source: "exports.handler = (event, context, callback) => callback(null, event);\n",
      expected: /Callback-style invocation completion is outside the promise contract/i,
    },
    {
      id: "sync",
      source: "exports.handler = (event) => ({ event });\n",
      expected: /synchronous invocation handler.*promise-returning asynchronous handler/i,
    },
    {
      id: "streaming",
      source: "exports.handler = async (_req, res) => { res.write('chunk'); res.end(); };\n",
      expected: /Streaming response completion is outside the promise contract/i,
    },
  ]) {
    const root = join(scratch, "refusals", refusal.id);
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, "package.json"), '{"name":"refusal","type":"commonjs"}\n');
    writeFileSync(join(root, "handler.js"), refusal.source);
    const before = allFiles(root).map((path) => [relative(root, path), readFileSync(path, "utf8")]);
    const result = await run(cli, ["errors", "init", "--yes"], {
      cwd: root,
      allowFailure: true,
    });
    assert(result.status !== 0, `${refusal.id} invocation was not refused`);
    assert(
      refusal.expected.test(`${result.stdout}\n${result.stderr}`),
      `${refusal.id} refusal was not precise:\n${result.stdout}\n${result.stderr}`,
    );
    const after = allFiles(root).map((path) => [relative(root, path), readFileSync(path, "utf8")]);
    assert(JSON.stringify(after) === JSON.stringify(before), `${refusal.id} refusal mutated files`);
  }
  process.stdout.write("✓ callback, synchronous, and streaming invocations refused before mutation\n");
}

try {
  assert(cells.length === 16, `expected 16 invocation cells, got ${cells.length}`);
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
  for (const [index, cell] of cells.entries()) {
    await conformCell(cell, { apiOrigin, dsn, cli, tooling, nodeBinaries }, index);
  }
  await assertRefusals(cli);
  process.stdout.write(
    `✓ ${cells.length} Node invocation cells passed setup, convergence, exact-version build/direct source, cold/warm/concurrent capture, bounded flush, privacy, return/rethrow, source resolution, and provider-neutrality\n`,
  );
} finally {
  await new Promise((resolveClose) => api.close(resolveClose));
  rmSync(scratch, { recursive: true, force: true });
}
