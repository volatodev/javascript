import { execFileSync, spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { TraceMap, originalPositionFor } from "@jridgewell/trace-mapping";
import { runtimeMatrix } from "./errors-runtime-matrix.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const scratch = mkdtempSync(join(tmpdir(), "volato-express-"));
const projectId = "00000000-0000-4000-8000-0000000001c1";
const authToken = "express-conformance-auth";
const ingestToken = "express-conformance-ingest";
const cliSpec = process.env.VOLATO_CLI_SPEC;
const cells = runtimeMatrix.cells.filter((cell) => cell.family === "express");
const runningChildren = new Set();

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
      rejectRun(new Error(`${command} timed out\n${stdout}\n${stderr}`));
    }, options.timeoutMs ?? 60_000);
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
  const root = join(scratch, "node-runtime");
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
  assert(existsSync(binary), `Node ${version} was not installed`);
  assert(
    execFileSync(binary, ["--version"], { encoding: "utf8" }).trim() ===
      `v${version}`,
    `Express conformance did not use Node ${version}`,
  );
  return binary;
}

function packageJson(cell) {
  const isTypeScript = cell.language === "ts";
  return {
    name: cell.id,
    private: true,
    type: cell.module === "esm" ? "module" : "commonjs",
    scripts: isTypeScript ? { build: "tsc --sourceMap" } : {},
    dependencies: { express: cell.express },
    ...(isTypeScript
      ? {
          devDependencies: {
            typescript: runtimeMatrix.versions.typescript[0],
            "@types/node": "24.12.2",
          },
        }
      : {}),
  };
}

function routes(cell, typeScript) {
  const typed = (name) => (typeScript ? `${name}: any` : name);
  const syncHandler = `(${typed("req")}, ${typed("res")}) => {
  res.status(422);
  throw new Error("sync ${cell.id}");
}`;
  const asyncHandler =
    cell.asyncPropagation === "returned-promise"
      ? `async (${typed("_req")}, ${typed("res")}) => {
  res.status(409);
  await Promise.resolve();
  throw new Error("async ${cell.id}");
}`
      : `async (${typed("_req")}, ${typed("res")}, ${typed("next")}) => {
  res.status(409);
  try {
    await Promise.resolve();
    throw new Error("async ${cell.id}");
  } catch (error) {
    next(error);
  }
}`;
  return `const router = express.Router();
router.post("/users/:userId", express.json(), ${syncHandler});
router.get("/async/:userId", ${asyncHandler});
router.get("/headers/:userId", (${typed("_req")}, ${typed("res")}, ${typed("next")}) => {
  res.write("partial-response");
  next(new Error("headers ${cell.id}"));
});
app.use((${typed("req")}, ${typed("_res")}, ${typed("next")}) => {
  req.id = req.get("x-request-id");
  next();
});
app.use("/api", router);
app.get("/health", (${typed("_req")}, ${typed("res")}) => res.status(204).end());
app.use((${typed("error")}, ${typed("_req")}, ${typed("res")}, ${typed("next")}) => {
  if (res.headersSent) return next(error);
  return res.status(418).json({ owner: "application", message: error.message });
});`;
}

function writeFixture(root, cell) {
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(
    join(root, "package.json"),
    `${JSON.stringify(packageJson(cell), null, 2)}\n`,
  );
  const isTypeScript = cell.language === "ts";
  if (cell.topology === "same-file") {
    const source = `import express from "express";
const app = express();
${routes(cell, true)}
const server = app.listen(0, () => {
  const address = server.address();
  if (address && typeof address === "object") console.log("READY:" + address.port);
});
process.on("SIGTERM", () => server.close());
`;
    writeFileSync(join(root, "src", "server.ts"), source);
    writeFileSync(
      join(root, "src", "express.d.ts"),
      'declare module "express" { const express: any; export default express; }\n',
    );
  } else {
    const app = `const express = require("express");
const app = express();
${routes(cell, false)}
module.exports = app;
`;
    const server = `const app = require("./app");
const server = app.listen(0, () => {
  const address = server.address();
  if (address && typeof address === "object") console.log("READY:" + address.port);
});
process.on("SIGTERM", () => server.close());
`;
    writeFileSync(join(root, "src", "app.js"), app);
    writeFileSync(join(root, "src", "server.js"), server);
  }
  if (isTypeScript) {
    writeFileSync(
      join(root, "tsconfig.json"),
      `${JSON.stringify(
        {
          compilerOptions: {
            target: "ES2022",
            module: "NodeNext",
            moduleResolution: "NodeNext",
            rootDir: "src",
            outDir: "dist",
            sourceMap: true,
            strict: true,
            skipLibCheck: true,
            esModuleInterop: true,
            lib: ["ES2022", "DOM"],
          },
          include: ["src"],
        },
        null,
        2,
      )}\n`,
    );
  }
  writeFileSync(join(root, ".gitignore"), "node_modules\ndist\n.env*.local\n");
}

function allFiles(root) {
  if (!existsSync(root)) return [];
  return readdirSync(root).flatMap((name) => {
    const path = join(root, name);
    return statSync(path).isDirectory() ? allFiles(path) : [path];
  });
}

function waitForServer(child) {
  return new Promise((resolveReady, rejectReady) => {
    let output = "";
    const timeout = setTimeout(
      () => rejectReady(new Error(`Express server did not start:\n${output}`)),
      10_000,
    );
    child.stdout.on("data", (chunk) => {
      output += chunk;
      const match = /READY:(\d+)/.exec(output);
      if (match) {
        clearTimeout(timeout);
        resolveReady(Number(match[1]));
      }
    });
    child.stderr.on("data", (chunk) => {
      output += chunk;
    });
    child.once("error", (error) => {
      clearTimeout(timeout);
      rejectReady(error);
    });
    child.once("close", (status) => {
      clearTimeout(timeout);
      rejectReady(new Error(`Express server exited ${status}:\n${output}`));
    });
  });
}

function stopServer(child) {
  return new Promise((resolveStop) => {
    if (child.exitCode !== null) {
      resolveStop();
      return;
    }
    child.once("close", resolveStop);
    child.kill("SIGTERM");
    setTimeout(() => {
      if (child.exitCode === null) child.kill("SIGKILL");
    }, 2_000).unref();
  });
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^$()|[\]\\{}]/g, "\\$&");
}

function assertSourceResolution(cell, fixture, appRelative, event, surface) {
  const sourcePath = join(fixture, appRelative);
  const source = readFileSync(sourcePath, "utf8");
  const expectedLine =
    source.split("\n").findIndex((line) => line.includes(`new Error("${surface} ${cell.id}")`)) +
    1;
  assert(expectedLine > 0, `${cell.id} has no ${surface} causal line`);
  const outputPath =
    cell.language === "ts"
      ? join(fixture, "dist", "server.js")
      : sourcePath;
  const frame = new RegExp(
    `${escapeRegExp(outputPath)}:(\\d+):(\\d+)`,
  ).exec(event.stack ?? "");
  assert(frame, `${cell.id} ${surface} stack missed ${outputPath}: ${event.stack}`);
  if (cell.language === "js") {
    assert(
      Number(frame[1]) === expectedLine,
      `${cell.id} ${surface} direct source line was ${frame[1]}, expected ${expectedLine}`,
    );
    return;
  }
  const map = JSON.parse(readFileSync(`${outputPath}.map`, "utf8"));
  assert(!("sourcesContent" in map), `${cell.id} retained sourcesContent`);
  const original = originalPositionFor(new TraceMap(map), {
    line: Number(frame[1]),
    column: Number(frame[2]) - 1,
  });
  assert(
    original.source?.replaceAll("\\", "/").endsWith(appRelative) &&
      original.line === expectedLine,
    `${cell.id} ${surface} resolved to ${original.source}:${original.line}, expected ${appRelative}:${expectedLine}`,
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
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        data: {
          projectId: setup[1],
          projectName: "Express matrix conformance",
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

async function assertRouteCapture(cell, fixture, port, appRelative, surface) {
  const before = state.events.length;
  const requestId = `request-safe-${cell.id}`;
  const isSync = surface === "sync";
  const response = await fetch(
    `http://127.0.0.1:${port}/api/${isSync ? "users" : "async"}/private-user?token=query-secret`,
    {
      method: isSync ? "POST" : "GET",
      headers: {
        authorization: "header-secret",
        cookie: "session=cookie-secret",
        "x-arbitrary": "arbitrary-secret",
        "x-request-id": requestId,
        ...(isSync ? { "content-type": "application/json" } : {}),
      },
      ...(isSync
        ? { body: JSON.stringify({ email: "body-private@example.com" }) }
        : {}),
    },
  );
  const body = await response.json();
  assert(
    response.status === 418 &&
      body.owner === "application" &&
      body.message === `${surface} ${cell.id}`,
    `${cell.id} ${surface} changed the application-owned response`,
  );
  const events = state.events.slice(before);
  assert(events.length === 1, `${cell.id} ${surface} emitted ${events.length} events`);
  const event = events[0];
  assert(
    event.runtime === "node" &&
      event.capturedVia === "express" &&
      event.method === (isSync ? "POST" : "GET") &&
      event.route === (isSync ? "/users/:userId" : "/async/:userId") &&
      event.status === (isSync ? 422 : 409) &&
      event.requestId === requestId,
    `${cell.id} ${surface} context failed: ${JSON.stringify(event)}`,
  );
  assert(
    !JSON.stringify(event).match(
      /private-user|query-secret|header-secret|cookie-secret|arbitrary-secret|body-private/,
    ),
    `${cell.id} ${surface} leaked request data`,
  );
  assertSourceResolution(cell, fixture, appRelative, event, surface);
}

async function conformCell(cell, context) {
  const fixture = join(scratch, "fixtures", cell.id);
  writeFixture(fixture, cell);
  await run("npm", ["install", "--no-audit", "--no-fund", "--cache", join(scratch, "npm")], {
    cwd: fixture,
  });
  await run(context.cli, ["init", "--project", projectId, "--yes"], {
    cwd: fixture,
    env: { VOLATO_API_URL: context.apiOrigin, VOLATO_TOKEN: authToken },
  });
  const integrationCount = state.integrations.length;
  const setup = await run(context.cli, ["errors", "init", "--yes"], {
    cwd: fixture,
    env: { VOLATO_API_URL: context.apiOrigin, VOLATO_TOKEN: authToken },
  });
  assert(
    !setup.stdout.includes("manual") &&
      state.integrations.slice(integrationCount).includes("errors-node"),
    `${cell.id} setup was incomplete:\n${setup.stdout}\n${setup.stderr}`,
  );
  assert(
    !readFileSync(join(fixture, "package.json"), "utf8").includes("@volatodev"),
    `${cell.id} gained a Volato runtime dependency`,
  );
  const appRelative =
    cell.topology === "same-file" ? "src/server.ts" : "src/app.js";
  const appSource = readFileSync(join(fixture, appRelative), "utf8");
  assert(
    appSource.indexOf('app.use("/api", router)') <
      appSource.indexOf("app.use(volatoExpressErrorHandler())") &&
      appSource.indexOf("app.use(volatoExpressErrorHandler())") <
        appSource.lastIndexOf("app.use((error"),
    `${cell.id} mounted capture outside the route/error-handler boundary`,
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
    const cellMaps = state.maps.slice(mapsBefore);
    assert(cellMaps.length >= 2, `${cell.id} did not upload private maps`);
    assert(
      cellMaps.every((body) => !body.includes("sourcesContent")) &&
        allFiles(join(fixture, "dist"))
          .filter((path) => path.endsWith(".map"))
          .every((path) => !readFileSync(path, "utf8").includes("sourcesContent")),
      `${cell.id} exposed sourcesContent`,
    );
  } else {
    assert(state.maps.length === mapsBefore, `${cell.id} unexpectedly uploaded maps`);
  }

  const executable =
    cell.language === "ts"
      ? join(fixture, "dist", "server.js")
      : join(fixture, "src", "server.js");
  const child = spawn(context.node, [executable], {
    cwd: fixture,
    env: {
      ...process.env,
      VOLATO_DSN: context.dsn,
      VOLATO_RELEASE: release,
      NODE_ENV: "production",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  runningChildren.add(child);
  try {
    const port = await waitForServer(child);
    await assertRouteCapture(cell, fixture, port, appRelative, "sync");
    await assertRouteCapture(cell, fixture, port, appRelative, "async");

    const headersBefore = state.events.length;
    try {
      const response = await fetch(
        `http://127.0.0.1:${port}/api/headers/private-user?token=query-secret`,
        { signal: AbortSignal.timeout(5_000) },
      );
      await response.text();
    } catch {
      // Express' default handler closes an already-started response. The
      // transport-level failure is the application/framework behavior being
      // preserved here.
    }
    const headersEvents = state.events.slice(headersBefore);
    assert(
      headersEvents.length === 1 &&
        headersEvents[0].message === `headers ${cell.id}` &&
        headersEvents[0].route === "/headers/:userId",
      `${cell.id} headers-sent propagation changed or duplicated capture`,
    );
    const health = await fetch(`http://127.0.0.1:${port}/health`);
    assert(health.status === 204, `${cell.id} did not survive handled route errors`);
  } finally {
    await stopServer(child);
    runningChildren.delete(child);
  }
  process.stdout.write(`✓ ${cell.id}\n`);
}

try {
  assert(cells.length === 4, `expected 4 Express cells, got ${cells.length}`);
  await new Promise((resolveListen, rejectListen) => {
    api.once("error", rejectListen);
    api.listen(0, "127.0.0.1", resolveListen);
  });
  const address = api.address();
  assert(address && typeof address === "object", "mock API did not bind");
  const apiOrigin = `http://127.0.0.1:${address.port}`;
  const dsn = `http://public@127.0.0.1:${address.port}/${projectId}`;
  const cli = installPackagedCli();
  const node = installExactNode(runtimeMatrix.versions.node[1]);
  for (const cell of cells) {
    await conformCell(cell, { apiOrigin, dsn, cli, node });
  }
  process.stdout.write(
    `✓ ${cells.length} Express cells passed topology, propagation, response ownership, privacy, maps/direct source, and exact source resolution\n`,
  );
} finally {
  for (const child of runningChildren) child.kill("SIGKILL");
  await new Promise((resolveClose) => api.close(resolveClose));
  rmSync(scratch, { recursive: true, force: true });
}
