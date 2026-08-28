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
import { basename, dirname, join, posix, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { originalPositionFor, TraceMap } from "@jridgewell/trace-mapping";
import { chromium } from "playwright";
import { runtimeMatrix } from "./errors-runtime-matrix.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const scratch = mkdtempSync(join(tmpdir(), "volato-sveltekit-calibration-"));
const projectId = "00000000-0000-4000-8000-000000000250";
const groupId = "00000000-0000-4000-8000-000000000251";
const authToken = "sveltekit-calibration-workspace-token";
const ingestToken = "sveltekit-calibration-ingest-token";
const requestedCell = process.argv.find((arg) => arg.startsWith("--cell="))?.slice(7);
const exactNode = !process.argv.includes("--host-node");
const cells = runtimeMatrix.cells.filter(
  (cell) =>
    cell.family === "sveltekit-node" &&
    (!requestedCell || cell.id === requestedCell),
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
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.once("error", rejectRun);
    child.once("close", (status) => {
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
  const packDir = join(scratch, "pack");
  mkdirSync(host, { recursive: true });
  mkdirSync(packDir, { recursive: true });
  writeFileSync(
    join(host, "package.json"),
    '{"name":"sveltekit-cli-host","private":true}\n',
  );
  execFileSync(
    "npm",
    ["pack", "--pack-destination", packDir, "--cache", join(scratch, "npm-cache")],
    { cwd: join(repositoryRoot, "packages", "cli"), stdio: "pipe" },
  );
  const archive = readdirSync(packDir).find((name) => name.endsWith(".tgz"));
  assert(archive, "npm pack produced no CLI archive");
  execFileSync(
    "npm",
    [
      "install",
      "--no-audit",
      "--no-fund",
      "--cache",
      join(scratch, "npm-cache"),
      join(packDir, archive),
    ],
    { cwd: host, stdio: "pipe" },
  );
  const cli = join(host, "node_modules", ".bin", "volato");
  assert(existsSync(cli), "packed CLI executable is missing");
  return cli;
}

function applicationHooks(cell, side) {
  const form =
    cell.id === "sveltekit2.node22.js"
      ? "named"
      : cell.id === "sveltekit2.node24.ts"
        ? "expression"
        : "none";
  if (form === "none") return null;
  const browser = side === "client";
  const body = browser
    ? `const target = globalThis;\n  target.__applicationSvelteKitErrors ??= [];\n  target.__applicationSvelteKitErrors.push(input.error instanceof Error ? input.error.message : String(input.error));`
    : `console.log("[application-server-hook]", input.error instanceof Error ? input.error.message : String(input.error));`;
  const result = `{ message: \`application:${side}:\${input.message}\`, code: "APPLICATION_${side.toUpperCase()}" }`;
  if (form === "named") {
    return `export const untouched = "${side}";
export function handleError(input) {
  ${body}
  return ${result};
}
`;
  }
  const typeName = browser ? "HandleClientError" : "HandleServerError";
  return `import type { ${typeName} } from "@sveltejs/kit";
export const untouched = "${side}";
export const handleError: ${typeName} = (input) => {
  ${body}
  return Promise.resolve(${result});
};
`;
}

function writeFixture(root, cell) {
  const extension = cell.language;
  for (const directory of [
    "src/routes/browser",
    "src/routes/client-load",
    "src/routes/ssr-render",
    "src/routes/server-load",
    "src/routes/action",
    "src/routes/expected",
    "src/routes/api/boom",
    "src/routes/api/expected",
  ]) {
    mkdirSync(join(root, directory), { recursive: true });
  }
  writeFileSync(
    join(root, "package.json"),
    `${JSON.stringify(
      {
        name: cell.id,
        private: true,
        type: "module",
        engines: { node: cell.node },
        scripts: { build: "vite build" },
        dependencies: {
          svelte: cell.svelte,
          "@sveltejs/kit": cell.svelteKit,
          "@sveltejs/adapter-node": cell.adapterVersion,
          "@sveltejs/vite-plugin-svelte": cell.vitePlugin,
          vite: cell.vite,
        },
      },
      null,
      2,
    )}\n`,
  );
  writeFileSync(join(root, ".node-version"), `${cell.node}\n`);
  writeFileSync(
    join(root, ".gitignore"),
    "node_modules/\n.svelte-kit/\nbuild/\n.env*.local\n",
  );
  writeFileSync(
    join(root, "src", "app.html"),
    '<!doctype html>\n<html lang="en">\n<head><meta charset="utf-8">%sveltekit.head%</head>\n<body><div style="display: contents">%sveltekit.body%</div></body>\n</html>\n',
  );
  writeFileSync(
    join(root, cell.language === "ts" ? "tsconfig.json" : "jsconfig.json"),
    `${JSON.stringify({
      extends: "./.svelte-kit/tsconfig.json",
      compilerOptions: {
        allowJs: true,
        checkJs: false,
        esModuleInterop: true,
        forceConsistentCasingInFileNames: true,
        resolveJsonModule: true,
        skipLibCheck: true,
        sourceMap: true,
        strict: true,
        moduleResolution: "bundler",
      },
    }, null, 2)}\n`,
  );
  writeFileSync(
    join(root, cell.config),
    `import adapter from "@sveltejs/adapter-node";
import { sveltekit } from "@sveltejs/kit/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [sveltekit({ adapter: adapter() })],
});
`,
  );
  writeFileSync(
    join(root, "src", "routes", "+page.svelte"),
    `<main><a id="client-load" href="/client-load">Client load</a><a id="browser" href="/browser">Browser failures</a></main>\n`,
  );
  writeFileSync(
    join(root, "src", "routes", "+error.svelte"),
    `<script>import { page } from "$app/state";</script>
<main id="application-error">{page.error?.message}|{page.error?.code ?? "DEFAULT"}</main>
`,
  );
  writeFileSync(
    join(root, "src", "routes", "client-load", `+page.${extension}`),
    `import { browser } from "$app/environment";
export function load() {
  if (browser) throw new Error("client-load:${cell.id}");
  return {};
}
`,
  );
  writeFileSync(
    join(root, "src", "routes", "client-load", "+page.svelte"),
    "<main>Client load route</main>\n",
  );
  writeFileSync(
    join(root, "src", "routes", "browser", "+page.svelte"),
    `<script>
  import { onMount } from "svelte";
  let shouldFail = $state(false);
  const renderFailure = new Error("render:${cell.id}");
  function renderValue() {
    if (shouldFail) throw renderFailure;
    return "ready";
  }
  onMount(() => {
    window.dispatchEvent(new ErrorEvent("error", { error: new Error("window:${cell.id}") }));
    Promise.reject(new Error("rejection:${cell.id}"));
    setTimeout(() => { shouldFail = true; }, 25);
  });
</script>
<main id="browser-ready">{renderValue()}</main>
`,
  );
  writeFileSync(
    join(root, "src", "routes", "ssr-render", "+page.svelte"),
    `<script>
  function renderValue() { throw new Error("ssr-render:${cell.id}"); }
</script>
<main>{renderValue()}</main>
`,
  );
  writeFileSync(
    join(root, "src", "routes", "server-load", `+page.server.${extension}`),
    `export function load() { throw new Error("server-load:${cell.id}"); }\n`,
  );
  writeFileSync(
    join(root, "src", "routes", "server-load", "+page.svelte"),
    "<main>Server load</main>\n",
  );
  writeFileSync(
    join(root, "src", "routes", "action", `+page.server.${extension}`),
    `export const actions = { default: async () => { throw new Error("action:${cell.id}"); } };\n`,
  );
  writeFileSync(
    join(root, "src", "routes", "action", "+page.svelte"),
    '<form method="POST"><input name="secret" value="body-secret"><button>Submit</button></form>\n',
  );
  writeFileSync(
    join(root, "src", "routes", "expected", `+page.server.${extension}`),
    `import { error } from "@sveltejs/kit";\nexport function load() { error(418, "Expected page outcome"); }\n`,
  );
  writeFileSync(
    join(root, "src", "routes", "expected", "+page.svelte"),
    "<main>Expected</main>\n",
  );
  writeFileSync(
    join(root, "src", "routes", "api", "boom", `+server.${extension}`),
    `export function GET() { throw new Error("endpoint:${cell.id}"); }\n`,
  );
  writeFileSync(
    join(root, "src", "routes", "api", "expected", `+server.${extension}`),
    `import { error } from "@sveltejs/kit";\nexport function GET() { error(418, "Expected endpoint outcome"); }\n`,
  );
  const clientHook = applicationHooks(cell, "client");
  const serverHook = applicationHooks(cell, "server");
  if (clientHook) writeFileSync(join(root, "src", `hooks.client.${extension}`), clientHook);
  if (serverHook) writeFileSync(join(root, "src", `hooks.server.${extension}`), serverHook);
}

function multipartField(body, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(
    `name="${escaped}"(?:; filename="[^"]+")?\\r\\n(?:Content-Type:[^\\r]+\\r\\n)?\\r\\n([\\s\\S]*?)\\r\\n--`,
  ).exec(body)?.[1];
}

const state = { events: [], integrations: [], maps: [], context: null };

function json(response, data, status = 200, markdown = "") {
  response.writeHead(status, {
    "content-type": "application/json",
    "access-control-allow-origin": "*",
  });
  response.end(
    JSON.stringify(status >= 200 && status < 300 ? { markdown, data } : { error: data }),
  );
}

const api = createServer((request, response) => {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  if (request.method === "OPTIONS") {
    response.writeHead(204, {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET, POST, OPTIONS",
      "access-control-allow-headers": "Content-Type, X-Volato-DSN, Authorization",
    });
    response.end();
    return;
  }
  if (request.method === "GET" && /^\/v1\/projects\/[0-9a-f-]+\/setup$/.test(url.pathname)) {
    const address = api.address();
    json(response, {
      projectId,
      projectName: "SvelteKit calibration",
      dsn: `http://public@127.0.0.1:${address.port}/${projectId}`,
      ingestToken,
    });
    return;
  }
  if (request.method === "POST" && /^\/v1\/projects\/[0-9a-f-]+\/linked$/.test(url.pathname)) {
    json(response, { projectId, linked: true });
    return;
  }
  const integration = url.pathname.match(
    /^\/v1\/projects\/[0-9a-f-]+\/integrations\/(errors-[a-z-]+)$/,
  );
  if (request.method === "POST" && integration) {
    state.integrations.push(integration[1]);
    json(response, { projectId, adapter: integration[1], recorded: true });
    return;
  }
  if (request.method === "POST" && url.pathname === "/api/ingest") {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => (body += chunk));
    request.on("end", () => {
      state.events.push(JSON.parse(body));
      response.writeHead(202, {
        "content-type": "application/json",
        "access-control-allow-origin": "*",
      });
      response.end(JSON.stringify({ data: { accepted: true } }));
    });
    return;
  }
  if (request.method === "POST" && url.pathname === "/api/sourcemaps") {
    let body = Buffer.alloc(0);
    request.on("data", (chunk) => (body = Buffer.concat([body, chunk])));
    request.on("end", () => {
      const text = body.toString("utf8");
      state.maps.push({
        release: multipartField(text, "release"),
        filenameHash: multipartField(text, "filename_hash"),
        displayPath: multipartField(text, "display_path"),
        map: multipartField(text, "map"),
        raw: text,
      });
      json(response, { uploaded: true }, 201);
    });
    return;
  }
  if (request.method === "GET" && url.pathname === "/v1/errors/context") {
    if (!state.context) return json(response, null, 404);
    return json(response, state.context, 200, `# ${state.context.group.message}\n`);
  }
  json(response, "not_found", 404);
});

function allFiles(root) {
  if (!existsSync(root)) return [];
  return readdirSync(root).flatMap((name) => {
    const path = join(root, name);
    return statSync(path).isDirectory() ? allFiles(path) : [path];
  });
}

function stablePathHash(path) {
  let hash = 0xcbf29ce484222325n;
  for (const character of path) {
    hash ^= BigInt(character.codePointAt(0) ?? 0);
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return `p${hash.toString(16).padStart(16, "0").slice(-15)}`;
}

function browserHash(path) {
  const stem = basename(new URL(path).pathname).replace(/\.(?:c|m)?js$/, "");
  if (!stem.includes(".") && /^[a-zA-Z0-9_-]{8,32}$/.test(stem)) return stem;
  return stem
    .split(".")
    .reverse()
    .find((part) => /^[a-zA-Z0-9_-]{8,32}$/.test(part));
}

function frameCandidates(stack) {
  return [
    ...String(stack ?? "").matchAll(
      /((?:https?:\/\/|file:\/\/\/)[^\s)]+?\.(?:mjs|js)):(\d+):(\d+)/g,
    ),
  ].map((match) => ({
    path: match[1],
    line: Number(match[2]),
    column: Number(match[3]),
  }));
}

function mapRecordForFrame(path, maps) {
  if (path.includes("/_app/")) {
    const key = browserHash(path);
    return maps.find((candidate) => candidate.filenameHash === key);
  }
  const marker = path.indexOf("/build/server/");
  if (marker < 0) return undefined;
  const displayPath = path.slice(marker + 1);
  return maps.find(
    (candidate) => candidate.filenameHash === stablePathHash(displayPath),
  );
}

function resolvedRelativeSource(displayPath, source) {
  if (!source || source.startsWith("\0") || /^[a-zA-Z][a-zA-Z+.-]*:/.test(source)) {
    return null;
  }
  const sourceRelative = source.replaceAll("\\", "/").replace(/^(?:\.\.\/)+/, "");
  if (
    sourceRelative.startsWith("src/") ||
    sourceRelative.startsWith(".svelte-kit/output/server/")
  ) {
    return sourceRelative;
  }
  const value = posix
    .normalize(posix.join(posix.dirname(displayPath), source.replaceAll("\\", "/")))
    .replace(/^\/+/, "");
  if (value === ".." || value.startsWith("../") || value.includes("/node_modules/")) {
    return null;
  }
  return value;
}

function resolveSource(event, expectedSuffix, maps) {
  for (const frame of frameCandidates(event.stack)) {
    const first = mapRecordForFrame(frame.path, maps);
    if (!first?.map || !first.displayPath) continue;
    const original = originalPositionFor(new TraceMap(JSON.parse(first.map)), {
      line: frame.line,
      column: Math.max(0, frame.column - 1),
    });
    let source = resolvedRelativeSource(first.displayPath, original.source);
    let line = original.line;
    let column = original.column;
    if (source?.startsWith(".svelte-kit/output/server/") && line) {
      const second = maps.find(
        (candidate) => candidate.filenameHash === stablePathHash(source),
      );
      if (!second?.map || !second.displayPath) continue;
      const chained = originalPositionFor(new TraceMap(JSON.parse(second.map)), {
        line,
        column: column ?? 0,
      });
      source = resolvedRelativeSource(second.displayPath, chained.source);
      line = chained.line;
      column = chained.column;
    }
    if (source?.endsWith(expectedSuffix) && line) {
      return {
        original_path: expectedSuffix,
        original_line: line,
        original_column: column ?? 0,
      };
    }
  }
  throw new Error(
    `${event.message} did not resolve to ${expectedSuffix}: ${JSON.stringify({
      frames: frameCandidates(event.stack),
      maps: maps.map(({ filenameHash, displayPath }) => ({ filenameHash, displayPath })),
    })}`,
  );
}

async function availablePort() {
  const holder = createServer();
  await new Promise((resolveListen, rejectListen) => {
    holder.once("error", rejectListen);
    holder.listen(0, "127.0.0.1", resolveListen);
  });
  const port = holder.address().port;
  await new Promise((resolveClose) => holder.close(resolveClose));
  return port;
}

function exactNodeContainerArgs(root, cell, env, command) {
  const workspace = resolve(root, "..", "..");
  const containerRoot = `/workspace/apps/${basename(root)}`;
  return [
    "run",
    "--rm",
    "--network",
    "host",
    "--user",
    `${process.getuid?.() ?? 1000}:${process.getgid?.() ?? 1000}`,
    "--volume",
    `${workspace}:/workspace`,
    "--workdir",
    containerRoot,
    "--env",
    "HOME=/tmp",
    ...Object.entries(env).flatMap(([key, value]) => ["--env", `${key}=${value}`]),
    `node:${cell.node}-bookworm-slim`,
    ...command,
  ];
}

async function buildCell(root, cell, env) {
  if (!exactNode) return run("pnpm", ["build"], { cwd: root, env });
  return run(
    "docker",
    exactNodeContainerArgs(root, cell, env, ["npm", "run", "build"]),
  );
}

async function startCell(root, cell, env) {
  const port = await availablePort();
  const origin = `http://127.0.0.1:${port}`;
  const runtimeEnv = {
    ...env,
    HOST: "127.0.0.1",
    PORT: String(port),
    ORIGIN: origin,
  };
  const child = exactNode
    ? spawn(
        "docker",
        exactNodeContainerArgs(root, cell, runtimeEnv, ["node", "build"]),
        { stdio: ["ignore", "pipe", "pipe"] },
      )
    : spawn(process.execPath, [join(root, "build")], {
        cwd: root,
        env: { ...process.env, ...runtimeEnv },
        stdio: ["ignore", "pipe", "pipe"],
      });
  let logs = "";
  child.stdout.on("data", (chunk) => (logs += chunk));
  child.stderr.on("data", (chunk) => (logs += chunk));
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`SvelteKit server exited early\n${logs}`);
    try {
      const response = await fetch(origin);
      if (response.status > 0) return { child, origin, logs: () => logs };
    } catch {}
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  child.kill("SIGTERM");
  throw new Error(`SvelteKit server did not start\n${logs}`);
}

async function stopChild(child) {
  if (child.exitCode !== null) return;
  child.kill("SIGTERM");
  await new Promise((resolveExit) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolveExit();
    }, 5_000);
    child.once("exit", () => {
      clearTimeout(timer);
      resolveExit();
    });
  });
}

async function waitForEvents(start, messages, timeout = 15_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const events = state.events.slice(start);
    if (messages.every((message) => events.some((event) => event.message === message))) {
      return events;
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 50));
  }
  throw new Error(`Timed out waiting for ${messages.join(", ")}`);
}

async function exerciseCell(cli, root, cell, apiOrigin) {
  const release = `${cell.id.replaceAll(".", "-")}-release`;
  const dsn = `${apiOrigin.replace("http://", "http://public@")}/${projectId}`;
  const mapStart = state.maps.length;
  const eventStart = state.events.length;
  const cliEnv = { VOLATO_API_URL: apiOrigin, VOLATO_TOKEN: authToken };
  await run(cli, ["init", "--project", projectId, "--yes"], { cwd: root, env: cliEnv });
  await run(cli, ["errors", "init", "--yes"], { cwd: root, env: cliEnv });
  const configPath = join(root, cell.config);
  const firstConfig = readFileSync(configPath, "utf8");
  const firstManifest = readFileSync(join(root, ".volato", "manifest.json"), "utf8");
  const firstClientHook = readFileSync(
    join(root, "src", `hooks.client.${cell.language}`),
    "utf8",
  );
  const firstServerHook = readFileSync(
    join(root, "src", `hooks.server.${cell.language}`),
    "utf8",
  );
  await run(cli, ["errors", "init", "--yes"], { cwd: root, env: cliEnv });
  assert(readFileSync(configPath, "utf8") === firstConfig, `${cell.id} config did not converge`);
  assert(
    readFileSync(join(root, ".volato", "manifest.json"), "utf8") === firstManifest,
    `${cell.id} manifest did not converge`,
  );
  assert(
    readFileSync(join(root, "src", `hooks.client.${cell.language}`), "utf8") === firstClientHook &&
      readFileSync(join(root, "src", `hooks.server.${cell.language}`), "utf8") === firstServerHook,
    `${cell.id} hook composition did not converge`,
  );
  assert(
    existsSync(join(root, ".agents", "skills", "volato-sveltekit", "SKILL.md")),
    `${cell.id} did not select the private SvelteKit skill`,
  );
  await buildCell(root, cell, {
    VOLATO_DSN: dsn,
    VITE_VOLATO_DSN: dsn,
    VITE_VOLATO_ENVIRONMENT: "production",
    VOLATO_INGEST_TOKEN: ingestToken,
    VOLATO_RELEASE: release,
  });
  const maps = state.maps.slice(mapStart);
  assert(maps.length >= 3, `${cell.id} did not upload all SvelteKit map families`);
  assert(
    maps.every(
      (record) =>
        record.release === release && record.map && !record.raw.includes("sourcesContent"),
    ),
    `${cell.id} uploaded unsafe maps or mixed releases`,
  );
  assert(
    maps.some((record) => record.displayPath?.startsWith("_app/")) &&
      maps.some((record) => record.displayPath?.startsWith("build/server/")) &&
      maps.some((record) => record.displayPath?.startsWith(".svelte-kit/output/server/")),
    `${cell.id} did not upload client, final server and intermediate server maps`,
  );
  assert(
    allFiles(join(root, "build")).every((path) => !path.endsWith(".map")) &&
      allFiles(join(root, ".svelte-kit", "output")).every((path) => !path.endsWith(".map")),
    `${cell.id} left a deployable or intermediate sourcemap`,
  );

  const runtime = await startCell(root, cell, { VOLATO_DSN: dsn, VOLATO_RELEASE: release });
  let clientHookMessages = [];
  try {
    const expectedBefore = state.events.length;
    const expectedPage = await fetch(`${runtime.origin}/expected?token=query-secret`, {
      headers: { accept: "text/html" },
    });
    const expectedEndpoint = await fetch(`${runtime.origin}/api/expected?token=query-secret`);
    assert(expectedPage.status === 418, `${cell.id} changed an expected page status`);
    assert(expectedEndpoint.status === 418, `${cell.id} changed an expected endpoint status`);
    await new Promise((resolveWait) => setTimeout(resolveWait, 250));
    assert(state.events.length === expectedBefore, `${cell.id} captured expected framework errors`);

    for (const [path, method, body] of [
      ["/ssr-render", "GET"],
      ["/server-load", "GET"],
      ["/api/boom?token=query-secret", "GET"],
      ["/action", "POST", "secret=body-secret"],
    ]) {
      const response = await fetch(`${runtime.origin}${path}`, {
        method,
        headers: {
          accept: "text/html",
          "content-type": "application/x-www-form-urlencoded",
          "x-request-id": "request-safe",
          "x-private-header": "private-header",
          origin: runtime.origin,
        },
        body,
      });
      const text = await response.text();
      assert(
        response.status === 500,
        `${cell.id} changed the ${path} failure status to ${response.status}: ${text.slice(0, 200)}`,
      );
      if (!path.startsWith("/api/")) {
        assert(text.includes("application-error"), `${cell.id} replaced the application error page for ${path}`);
      }
      if (applicationHooks(cell, "server") && !path.startsWith("/api/")) {
        assert(
          text.includes("application:server:") && text.includes("APPLICATION_SERVER"),
          `${cell.id} lost the server handleError return value for ${path}`,
        );
      }
    }

    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.goto(runtime.origin);
      await page.click("#client-load");
      await page.waitForSelector("#application-error");
      const clientErrorText = await page.textContent("#application-error");
      if (applicationHooks(cell, "client")) {
        assert(
          clientErrorText?.includes("application:client:") &&
            clientErrorText.includes("APPLICATION_CLIENT"),
          `${cell.id} lost the client handleError return value`,
        );
      }
      clientHookMessages = await page.evaluate(
        () => globalThis.__applicationSvelteKitErrors ?? [],
      );
      await page.goto(`${runtime.origin}/browser?email=private@example.com`);
      await waitForEvents(eventStart, [
        `window:${cell.id}`,
        `rejection:${cell.id}`,
        `render:${cell.id}`,
      ]);
    } finally {
      await browser.close();
    }
    await waitForEvents(eventStart, [
      `client-load:${cell.id}`,
      `ssr-render:${cell.id}`,
      `server-load:${cell.id}`,
      `endpoint:${cell.id}`,
      `action:${cell.id}`,
    ]);
  } finally {
    await stopChild(runtime.child);
  }

  const names = [
    "window",
    "rejection",
    "render",
    "client-load",
    "ssr-render",
    "server-load",
    "endpoint",
    "action",
  ];
  const events = state.events.slice(eventStart).filter((event) =>
    String(event.message).endsWith(cell.id),
  );
  for (const name of names) {
    assert(
      events.filter((event) => event.message === `${name}:${cell.id}`).length === 1,
      `${cell.id} did not emit exactly one ${name} event: ${JSON.stringify(
        events
          .filter((event) => event.message === `${name}:${cell.id}`)
          .map(({ message, capturedVia, runtime, stack }) => ({
            message,
            capturedVia,
            runtime,
            stack,
          })),
      )}`,
    );
  }
  const byMessage = Object.fromEntries(events.map((event) => [event.message, event]));
  assert(byMessage[`window:${cell.id}`].capturedVia === "window_error", `${cell.id} lost window ownership`);
  assert(
    byMessage[`rejection:${cell.id}`].capturedVia === "unhandled_rejection",
    `${cell.id} lost rejection ownership`,
  );
  assert(byMessage[`render:${cell.id}`].capturedVia === "window_error", `${cell.id} misowned post-mount render`);
  assert(
    byMessage[`client-load:${cell.id}`].capturedVia === "sveltekit_client_handle_error",
    `${cell.id} lost client hook ownership`,
  );
  for (const name of ["ssr-render", "server-load", "endpoint", "action"]) {
    const event = byMessage[`${name}:${cell.id}`];
    assert(
      event.capturedVia === "sveltekit_server_handle_error" && event.runtime === "node",
      `${cell.id} lost server hook ownership for ${name}`,
    );
    assert(event.status === 500, `${cell.id} lost the framework status for ${name}`);
  }
  assert(
    byMessage[`endpoint:${cell.id}`].route === "/api/boom" &&
      byMessage[`endpoint:${cell.id}`].method === "GET" &&
      byMessage[`endpoint:${cell.id}`].requestId === "request-safe",
    `${cell.id} lost bounded endpoint context`,
  );
  assert(
    events.every(
      (event) =>
        event.release === release &&
        !JSON.stringify(event).match(
          /query-secret|body-secret|private@example\.com|private-header|Internal Error|APPLICATION_(?:CLIENT|SERVER)/,
        ),
    ),
    `${cell.id} emitted unsafe hook/request context or mixed release identity`,
  );
  if (applicationHooks(cell, "client")) {
    assert(
      clientHookMessages.includes(`client-load:${cell.id}`),
      `${cell.id} did not preserve the application client hook`,
    );
  }
  if (applicationHooks(cell, "server")) {
    assert(
      runtime.logs().includes("[application-server-hook]"),
      `${cell.id} did not preserve the application server hook`,
    );
  }

  resolveSource(byMessage[`render:${cell.id}`], "src/routes/browser/+page.svelte", maps);
  resolveSource(
    byMessage[`client-load:${cell.id}`],
    `src/routes/client-load/+page.${cell.language}`,
    maps,
  );
  const serverSource = resolveSource(
    byMessage[`server-load:${cell.id}`],
    `src/routes/server-load/+page.server.${cell.language}`,
    maps,
  );
  resolveSource(byMessage[`ssr-render:${cell.id}`], "src/routes/ssr-render/+page.svelte", maps);
  resolveSource(
    byMessage[`endpoint:${cell.id}`],
    `src/routes/api/boom/+server.${cell.language}`,
    maps,
  );
  resolveSource(
    byMessage[`action:${cell.id}`],
    `src/routes/action/+page.server.${cell.language}`,
    maps,
  );

  state.context = {
    group: {
      id: groupId,
      projectId,
      projectName: "SvelteKit calibration",
      fingerprint: `sveltekit:${cell.id}`,
      message: `server-load:${cell.id}`,
      severity: "error",
      status: "unresolved",
      eventCount: 1,
      matchingEventCount: 1,
      affectedUserCount: 0,
      firstSeen: "2026-08-28T10:00:00.000Z",
      lastSeen: "2026-08-28T10:00:00.000Z",
      firstMatchedAt: "2026-08-28T10:00:00.000Z",
      lastMatchedAt: "2026-08-28T10:00:00.000Z",
      runtimes: ["node"],
      routes: ["/server-load"],
      releases: [release],
      baselineEventCount: 0,
      growthDelta: 1,
      growthRatio: null,
    },
    events: [byMessage[`server-load:${cell.id}`]],
    commitTransition: null,
    resolvedFrame: serverSource,
    resolutionState: "unresolved",
    history: [],
    affectedUsers: { count: 0 },
    similarResolved: [],
  };
  const context = await run(
    cli,
    ["errors", "show", groupId, "--project-id", projectId, "--json"],
    { cwd: root, env: cliEnv },
  );
  const parsed = JSON.parse(context.stdout);
  assert(
    parsed.data?.resolvedFrame?.original_path ===
      `src/routes/server-load/+page.server.${cell.language}` &&
      parsed.data?.group?.status === "unresolved",
    `${cell.id} CLI context lost exact source or honest recovery state`,
  );
}

await new Promise((resolveListen, rejectListen) => {
  api.once("error", rejectListen);
  api.listen(0, "127.0.0.1", resolveListen);
});

let keepScratch = process.env.VOLATO_KEEP_CALIBRATION === "1";
try {
  assert(
    cells.length > 0,
    `No SvelteKit calibration cell matches ${requestedCell ?? "the matrix"}`,
  );
  const workspace = join(scratch, "workspace");
  mkdirSync(join(workspace, "apps"), { recursive: true });
  writeFileSync(join(workspace, "pnpm-workspace.yaml"), "packages:\n  - 'apps/*'\n");
  writeFileSync(join(workspace, ".npmrc"), "engine-strict=false\n");
  writeFileSync(
    join(workspace, "package.json"),
    '{"name":"sveltekit-calibration","private":true}\n',
  );
  for (const cell of cells) writeFixture(join(workspace, "apps", cell.id), cell);
  await run("pnpm", ["install"], { cwd: workspace });
  if (exactNode) {
    for (const node of [...new Set(cells.map((cell) => cell.node))]) {
      await run("docker", ["pull", `node:${node}-bookworm-slim`]);
    }
  }
  const cli = installPackagedCli();
  const apiOrigin = `http://127.0.0.1:${api.address().port}`;
  for (const [index, cell] of cells.entries()) {
    await exerciseCell(cli, join(workspace, "apps", cell.id), cell, apiOrigin);
    process.stdout.write(`✓ ${index + 1}/${cells.length} ${cell.id}\n`);
  }
  assert(
    state.integrations.filter((id) => id === "errors-sveltekit").length ===
      cells.length * 2,
    "SvelteKit activation was not reported after both convergent setup runs",
  );
  process.stdout.write(
    `✓ ${cells.length} private SvelteKit cells passed packed detection, convergent hook composition, exact-Node production build, browser/client/server capture, expected-error silence, privacy, lifecycle, chained source resolution and CLI retrieval\n`,
  );
} catch (error) {
  keepScratch = true;
  process.stderr.write(
    `${error instanceof Error ? error.stack : String(error)}\nCalibration fixtures kept at ${scratch}\n`,
  );
  process.exitCode = 1;
} finally {
  await new Promise((resolveClose) => api.close(resolveClose));
  if (!keepScratch) rmSync(scratch, { recursive: true, force: true });
}
