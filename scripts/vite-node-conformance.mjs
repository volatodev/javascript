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

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const scratch = mkdtempSync(join(tmpdir(), "volato-vite-node-conformance-"));
const projectId = "00000000-0000-4000-8000-000000000101";
const authToken = "vite-node-agent-token";
const ingestToken = "vite-node-ingest-token";
const cliSpec = process.env.VOLATO_CLI_SPEC;

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
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.once("error", rejectRun);
    child.once("close", (status) => {
      if (status !== 0 && !options.allowFailure) {
        rejectRun(
          new Error(`${command} ${args.join(" ")} failed (${status})\n${stdout}\n${stderr}`),
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

function allFiles(root) {
  return readdirSync(root).flatMap((name) => {
    const path = join(root, name);
    return statSync(path).isDirectory() ? allFiles(path) : [path];
  });
}

function writeFixture(root) {
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(
    join(root, "package.json"),
    `${JSON.stringify(
      {
        name: "volato-vite-node-conformance",
        private: true,
        type: "module",
        scripts: {
          build:
            "vite build && tsup src/server.ts --format esm --sourcemap --out-dir dist/server",
        },
        dependencies: {
          express: "5.1.0",
          react: "19.1.1",
          "react-dom": "19.1.1",
          vite: "7.3.6",
        },
        devDependencies: {
          "@types/express": "latest",
          "@types/node": "latest",
          "@types/react": "latest",
          "@types/react-dom": "latest",
          "happy-dom": "20.10.6",
          tsup: "8.5.1",
          typescript: "5.9.3",
          vitest: "3.2.7",
        },
      },
      null,
      2,
    )}\n`,
  );
  writeFileSync(join(root, "index.html"), '<div id="root"></div><script type="module" src="/src/main.tsx"></script>\n');
  writeFileSync(
    join(root, "src", "App.tsx"),
    'export default function App() { return <main>Volato conformance</main>; }\n',
  );
  writeFileSync(
    join(root, "src", "main.tsx"),
    'import React from "react";\nimport { createRoot } from "react-dom/client";\nimport App from "./App";\ncreateRoot(document.getElementById("root")!).render(<App />);\n',
  );
  writeFileSync(
    join(root, "vite.config.ts"),
    'import { defineConfig } from "vite";\nexport default defineConfig({});\n',
  );
  writeFileSync(
    join(root, "src", "server.ts"),
    `import express from "express";
import { captureNodeException } from "./volato-node/node.js";
const app = express();
app.get("/health", (_req, res) => res.send("ok"));
app.get("/manual", async (_req, res) => {
  await captureNodeException(new Error("Manual Node conformance"));
  res.send("ok");
});
app.get("/private-object", async (_req, res) => {
  await captureNodeException({ email: "private@example.com", token: "node-secret" });
  res.send("ok");
});
app.get("/boom", () => { throw new Error("Express conformance failure"); });
if (process.argv.includes("--fatal")) {
  setTimeout(() => { throw new Error("Fatal Node conformance failure"); }, 20);
}
if (process.argv.includes("--reject")) {
  setTimeout(() => { void Promise.reject(new Error("Rejected Node conformance failure")); }, 20);
}
const server = app.listen(Number(process.env.PORT ?? 0), () => {
  const address = server.address();
  if (address && typeof address === "object") console.log("READY:" + address.port);
});
`,
  );
  writeFileSync(
    join(root, "src", "browser-conformance.test.tsx"),
    `// @vitest-environment happy-dom
import React from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import {
  initVolatoBrowser,
  captureBrowserError,
  VolatoErrorBoundary,
} from "./volato/browser";

const dsn = process.env.VOLATO_TEST_DSN!;

describe("generated browser runtime", () => {
  it("captures manual, window, and React render errors", async () => {
    initVolatoBrowser({ dsn, environment: "development", release: process.env.VOLATO_RELEASE });
    expect(await captureBrowserError(new Error("Development browser event"))).toBe(false);
    initVolatoBrowser({ dsn, environment: "production", release: process.env.VOLATO_RELEASE });
    expect(await captureBrowserError(new Error("Manual browser conformance"))).toBe(true);
    expect(await captureBrowserError({ email: "private@example.com", token: "browser-secret" })).toBe(true);
    window.dispatchEvent(new ErrorEvent("error", { error: new Error("Window browser conformance") }));
    const rejection = new Event("unhandledrejection");
    Object.defineProperty(rejection, "reason", {
      value: new Error("Rejected browser conformance"),
    });
    window.dispatchEvent(rejection);

    function Boom(): React.ReactNode {
      throw new Error("React render conformance");
    }
    const root = document.createElement("div");
    document.body.appendChild(root);
    createRoot(root).render(<VolatoErrorBoundary><Boom /></VolatoErrorBoundary>);
    await new Promise((resolve) => setTimeout(resolve, 150));
  });
});
`,
  );
  writeFileSync(
    join(root, "tsconfig.json"),
    `${JSON.stringify(
      {
        compilerOptions: {
          target: "ES2022",
          module: "ESNext",
          moduleResolution: "Bundler",
          jsx: "react-jsx",
          strict: true,
          esModuleInterop: true,
          skipLibCheck: true,
          types: ["vite/client", "node"],
        },
        include: ["src", "vite.config.ts"],
      },
      null,
      2,
    )}\n`,
  );
  writeFileSync(join(root, ".gitignore"), "node_modules\ndist\n.env*.local\n");
}

const state = { events: [], maps: [], integrations: [] };
const api = createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  if (req.method === "OPTIONS" && url.pathname === "/api/ingest") {
    res.writeHead(204, {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "POST, OPTIONS",
      "access-control-allow-headers": "Content-Type, X-Volato-DSN",
    });
    res.end();
    return;
  }
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
          projectName: "Vite Node conformance",
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
      res.writeHead(202, {
        "content-type": "application/json",
        "access-control-allow-origin": "*",
      });
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

async function waitForServer(child) {
  return new Promise((resolveReady, rejectReady) => {
    let output = "";
    const timeout = setTimeout(() => rejectReady(new Error(`Node server did not start:\n${output}`)), 10_000);
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
    child.once("error", rejectReady);
  });
}

try {
  await new Promise((resolveListen, rejectListen) => {
    api.once("error", rejectListen);
    api.listen(0, "127.0.0.1", resolveListen);
  });
  const address = api.address();
  assert(address && typeof address === "object", "mock API did not bind");
  const apiOrigin = `http://127.0.0.1:${address.port}`;
  const dsn = `http://public@127.0.0.1:${address.port}/${projectId}`;
  const fixture = join(scratch, "fixture");
  writeFixture(fixture);
  await run("pnpm", ["install", "--ignore-scripts"], { cwd: fixture });

  const cli = installPackagedCli();
  await run(cli, ["init", "--project", projectId, "--yes"], {
    cwd: fixture,
    env: { VOLATO_API_URL: apiOrigin, VOLATO_TOKEN: authToken },
  });
  const setup = await run(cli, ["errors", "init", "--yes"], {
    cwd: fixture,
    env: { VOLATO_API_URL: apiOrigin, VOLATO_TOKEN: authToken },
  });
  assert(
    setup.stdout.includes("Volato Errors is ready") &&
      state.integrations.includes("errors-vite-react") &&
      state.integrations.includes("errors-node"),
    `setup did not install both adapters:\n${setup.stdout}\n${setup.stderr}`,
  );
  for (const required of [
    ".agents/skills/volato-vite-react/SKILL.md",
    ".agents/skills/volato-node/SKILL.md",
    "src/volato/browser.tsx",
    "src/volato/vite.ts",
    "src/volato-node/node.ts",
    "src/volato-node/express.ts",
    ".volato/manifest.json",
  ]) {
    assert(existsSync(join(fixture, required)), `setup did not create ${required}`);
  }

  await run("git", ["init", "-q"], { cwd: fixture });
  await run("git", ["config", "user.name", "Volato Conformance"], { cwd: fixture });
  await run("git", ["config", "user.email", "conformance@volato.dev"], { cwd: fixture });
  await run("git", ["add", "."], { cwd: fixture });
  await run("git", ["commit", "-qm", "conformance fixture"], { cwd: fixture });
  const release = (
    await run("git", ["rev-parse", "HEAD"], { cwd: fixture })
  ).stdout.trim();

  await run("pnpm", ["exec", "tsc", "--noEmit"], { cwd: fixture });
  await run("pnpm", ["build"], {
    cwd: fixture,
    env: {
      VITE_VOLATO_DSN: dsn,
      VOLATO_DSN: dsn,
      VOLATO_INGEST_TOKEN: ingestToken,
      VOLATO_RELEASE: release,
    },
  });
  assert(state.maps.length >= 2, "browser and Node builds did not upload sourcemaps");
  assert(
    state.maps.every((body) => !body.includes("sourcesContent")),
    "a sourcemap upload contained sourcesContent",
  );
  assert(
    state.maps.some((body) => body.includes("dist/server/") && /p[a-f0-9]{15}/.test(body)),
    "Node sourcemap did not use the stable dist-path key",
  );
  const browserBundles = allFiles(join(fixture, "dist", "assets"))
    .filter((path) => path.endsWith(".js"))
    .map((path) => readFileSync(path, "utf8"))
    .join("\n");
  assert(!browserBundles.includes(ingestToken), "browser bundle contains the ingest token");

  const beforeBrowser = state.events.length;
  await run("pnpm", ["exec", "vitest", "run", "src/browser-conformance.test.tsx"], {
    cwd: fixture,
    env: { VOLATO_TEST_DSN: dsn, VOLATO_RELEASE: release },
  });
  const browserEvents = state.events.slice(beforeBrowser);
  assert(
    browserEvents.length >= 4 &&
      browserEvents.every((event) => event.runtime === "browser") &&
      browserEvents.some((event) => event.capturedVia === "unhandled_rejection") &&
      !browserEvents.some((event) => event.message === "Development browser event"),
    `browser conformance produced unexpected events: ${JSON.stringify(browserEvents)}`,
  );
  assert(
    !JSON.stringify(browserEvents).includes("private@example.com") &&
      !JSON.stringify(browserEvents).includes("browser-secret"),
    "browser capture serialized arbitrary rejected-object fields",
  );

  const beforeDevelopmentNode = state.events.length;
  const developmentServer = spawn(
    process.execPath,
    [join(fixture, "dist", "server", "server.js")],
    {
      cwd: fixture,
      env: {
        ...process.env,
        NODE_ENV: "development",
        VOLATO_DSN: dsn,
        VOLATO_RELEASE: release,
        PORT: "0",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  const developmentPort = await waitForServer(developmentServer);
  const developmentResponse = await fetch(
    `http://127.0.0.1:${developmentPort}/manual`,
  );
  assert(
    developmentResponse.status === 200,
    `Development Node capture changed response to ${developmentResponse.status}`,
  );
  await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  developmentServer.kill("SIGTERM");
  await new Promise((resolveExit) => developmentServer.once("close", resolveExit));
  assert(
    state.events.length === beforeDevelopmentNode,
    "Node capture was enabled in development by default",
  );

  const server = spawn(process.execPath, [join(fixture, "dist", "server", "server.js")], {
    cwd: fixture,
    env: { ...process.env, VOLATO_DSN: dsn, VOLATO_RELEASE: release, PORT: "0" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const port = await waitForServer(server);
  const manualResponse = await fetch(`http://127.0.0.1:${port}/manual`);
  assert(manualResponse.status === 200, `Manual Node capture changed response to ${manualResponse.status}`);
  const privateObjectResponse = await fetch(`http://127.0.0.1:${port}/private-object`);
  assert(privateObjectResponse.status === 200, `Private-object Node capture changed response to ${privateObjectResponse.status}`);
  const response = await fetch(`http://127.0.0.1:${port}/boom`);
  assert(response.status === 500, `Express error response changed to ${response.status}`);
  await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  server.kill("SIGTERM");
  await new Promise((resolveExit) => server.once("close", resolveExit));
  const expressEvent = state.events.find(
    (event) => event.message === "Express conformance failure",
  );
  assert(
    expressEvent?.runtime === "node" &&
      expressEvent.route === "/boom" &&
      expressEvent.request === undefined &&
      expressEvent.headers === undefined,
    `Express capture leaked or missed context: ${JSON.stringify(expressEvent)}`,
  );
  assert(
    state.events.some(
      (event) =>
        event.message === "Manual Node conformance" &&
        event.runtime === "node" &&
        event.capturedVia === "manual",
    ),
    "manual Node capture did not reach ingest",
  );
  assert(
    !JSON.stringify(state.events).includes("private@example.com") &&
      !JSON.stringify(state.events).includes("node-secret"),
    "Node capture serialized arbitrary thrown-object fields",
  );

  const fatal = await run(
    process.execPath,
    [join(fixture, "dist", "server", "server.js"), "--fatal"],
    {
      cwd: fixture,
      env: { VOLATO_DSN: dsn, VOLATO_RELEASE: release, PORT: "0" },
      allowFailure: true,
    },
  );
  assert(fatal.status !== 0, "fatal Node error was swallowed");
  assert(
    state.events.some(
      (event) =>
        event.message === "Fatal Node conformance failure" &&
        event.runtime === "node" &&
        event.capturedVia === "uncaught_exception",
    ),
    "fatal Node error exited without a bounded capture",
  );

  const rejected = await run(
    process.execPath,
    [join(fixture, "dist", "server", "server.js"), "--reject"],
    {
      cwd: fixture,
      env: { VOLATO_DSN: dsn, VOLATO_RELEASE: release, PORT: "0" },
      allowFailure: true,
    },
  );
  assert(rejected.status !== 0, "unhandled Node rejection was swallowed");
  assert(
    state.events.some(
      (event) =>
        event.message === "Rejected Node conformance failure" &&
        event.runtime === "node" &&
        event.capturedVia === "unhandled_rejection",
    ),
    "unhandled Node rejection exited without a bounded capture",
  );

  process.stdout.write(
    "✓ Vite + React browser and Node + Express server capture, maps, privacy, and fatal exit\n",
  );
} finally {
  await new Promise((resolveClose) => api.close(resolveClose));
  rmSync(scratch, { recursive: true, force: true });
}
