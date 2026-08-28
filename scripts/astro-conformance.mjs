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
const scratch = mkdtempSync(join(tmpdir(), "volato-astro-calibration-"));
const projectId = "00000000-0000-4000-8000-000000000280";
const authToken = "astro-calibration-workspace-token";
const ingestToken = "astro-calibration-ingest-token";
const requestedCell = process.argv.find((arg) => arg.startsWith("--cell="))?.slice(7);
const exactNode = !process.argv.includes("--host-node");
const cells = runtimeMatrix.cells.filter(
  (cell) =>
    cell.family === "astro-node" &&
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
  writeFileSync(join(host, "package.json"), '{"name":"astro-cli-host","private":true}\n');
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

function rendererDependencies(cell) {
  if (cell.renderer === "react") {
    return {
      "@astrojs/react": cell.rendererVersion,
      react: cell.runtimeVersion,
      "react-dom": cell.runtimeVersion,
      "@vitejs/plugin-react": "5.2.0",
    };
  }
  if (cell.renderer === "vue") {
    return {
      "@astrojs/vue": cell.rendererVersion,
      vue: cell.runtimeVersion,
      "@vitejs/plugin-vue": "6.0.8",
    };
  }
  if (cell.renderer === "svelte") {
    return {
      "@astrojs/svelte": cell.rendererVersion,
      svelte: cell.runtimeVersion,
      "@sveltejs/vite-plugin-svelte": "7.3.0",
      typescript: "5.9.3",
    };
  }
  return {};
}

function rendererFixture(root, cell) {
  const extension = cell.language === "ts" ? "tsx" : "jsx";
  if (cell.renderer === "react") {
    writeFileSync(
      join(root, "src", "components", `Hydration.${extension}`),
      `import { useEffect } from "react";
export default function Hydration() {
  useEffect(() => { throw new Error("renderer-client:${cell.id}"); }, []);
  return <p id="renderer-ready">React ready</p>;
}
`,
    );
    return {
      importLine: 'import react from "@astrojs/react";\n',
      integration: "react()",
      hydrationImport: `import Hydration from "../components/Hydration.${extension}";`,
      hydrationMarkup: "<Hydration client:load />",
      clientSource: `src/components/Hydration.${extension}`,
    };
  }
  if (cell.renderer === "vue") {
    writeFileSync(
      join(root, "src", "components", "Hydration.vue"),
      `<script${cell.language === "ts" ? ' lang="ts"' : ""}>
export default { mounted() { throw new Error("renderer-client:${cell.id}"); } };
</script>
<template><p id="renderer-ready">Vue ready</p></template>
`,
    );
    return {
      importLine: 'import vue from "@astrojs/vue";\n',
      integration: "vue()",
      hydrationImport: 'import Hydration from "../components/Hydration.vue";',
      hydrationMarkup: "<Hydration client:load />",
      clientSource: "src/components/Hydration.vue",
    };
  }
  if (cell.renderer === "svelte") {
    writeFileSync(
      join(root, "src", "components", "Hydration.svelte"),
      `<script${cell.language === "ts" ? ' lang="ts"' : ""}>
  if (typeof window !== "undefined") {
    throw new Error("renderer-client:${cell.id}");
  }
</script>
<p id="renderer-ready">Svelte ready</p>
`,
    );
    return {
      importLine: 'import svelte from "@astrojs/svelte";\n',
      integration: "svelte()",
      hydrationImport: 'import Hydration from "../components/Hydration.svelte";',
      hydrationMarkup: "<Hydration client:load />",
      clientSource: "src/components/Hydration.svelte",
    };
  }
  return null;
}

function writeFixture(root, cell) {
  for (const directory of ["src/pages/api", "src/components"]) {
    mkdirSync(join(root, directory), { recursive: true });
  }
  const dependencies = {
    astro: cell.astro,
    "@astrojs/node": cell.adapterVersion,
    vite: cell.vite,
    ...rendererDependencies(cell),
  };
  writeFileSync(
    join(root, "package.json"),
    `${JSON.stringify(
      {
        name: cell.id,
        private: true,
        type: "module",
        engines: { node: cell.node },
        scripts: { build: "astro build" },
        dependencies,
      },
      null,
      2,
    )}\n`,
  );
  writeFileSync(join(root, ".node-version"), `${cell.node}\n`);
  writeFileSync(join(root, ".gitignore"), "node_modules/\ndist/\n.env*.local\n");
  const renderer = rendererFixture(root, cell);
  writeFileSync(
    join(root, "astro.config.mjs"),
    `import { defineConfig } from "astro/config";
import node from "@astrojs/node";
${renderer?.importLine ?? ""}const applicationIntegration = { name: "application-static-integration", hooks: {} };

export default defineConfig({
  output: "server",
  adapter: node({ mode: "standalone" }),
  integrations: [applicationIntegration${renderer ? `, ${renderer.integration}` : ""}],
  vite: { define: { __APPLICATION_FLAG__: JSON.stringify("kept") }, build: { minify: false } },
});
`,
  );
  const language = cell.language;
  writeFileSync(
    join(root, "src", `client.${language}`),
    `export function authoredBrowserFailure() { throw new Error("authored-browser:${cell.id}"); }
`,
  );
  writeFileSync(
    join(root, "src", "pages", "index.astro"),
    `---
---
<main><h1>Astro ready</h1><a id="renderer" href="/renderer">Renderer</a></main>
<script>
  import { authoredBrowserFailure } from "../client.${language}";
  queueMicrotask(() => {
    try { authoredBrowserFailure(); } catch (error) {
      window.dispatchEvent(new ErrorEvent("error", { error }));
    }
    Promise.reject(new Error("authored-rejection:${cell.id}"));
  });
</script>
`,
  );
  writeFileSync(
    join(root, "src", "pages", "renderer.astro"),
    renderer
      ? `---\n${renderer.hydrationImport}\n---\n<main>${renderer.hydrationMarkup}</main>\n`
      : "<main id=\"core-only\">Core</main>\n",
  );
  writeFileSync(
    join(root, "src", "pages", "render-error.astro"),
    `---\nthrow Object.assign(new Error("astro-render:${cell.id}"), { privateEmail: "private@example.com" });\n---\n`,
  );
  writeFileSync(
    join(root, "src", "pages", "500.astro"),
    '<html><body><main id="application-500">Application 500</main></body></html>\n',
  );
  writeFileSync(
    join(root, "src", "components", "DeferredError.astro"),
    `---\nthrow new Error("server-island:${cell.id}");\n---\n<p>never</p>\n`,
  );
  writeFileSync(
    join(root, "src", "pages", "server-island.astro"),
    `---\nimport DeferredError from "../components/DeferredError.astro";\n---\n<main><DeferredError server:defer /></main>\n`,
  );
  writeFileSync(
    join(root, "src", "pages", "api", `boom.${language}`),
    `export function GET() { throw new Error("endpoint:${cell.id}"); }\n`,
  );
  writeFileSync(
    join(root, "src", `middleware.${language}`),
    `import { defineMiddleware } from "astro:middleware";
export const onRequest = defineMiddleware(async (context, next) => {
  if (context.url.pathname === "/middleware-error") {
    throw new Error("application-middleware:${cell.id}");
  }
  const response = await next();
  response.headers.set("x-application-middleware", "preserved");
  return response;
});
`,
  );
  return renderer;
}

function multipartField(body, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(
    `name="${escaped}"(?:; filename="[^"]+")?\\r\\n(?:Content-Type:[^\\r]+\\r\\n)?\\r\\n([\\s\\S]*?)\\r\\n--`,
  ).exec(body)?.[1];
}

const state = { events: [], integrations: [], maps: [] };

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
      projectName: "Astro calibration",
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
  ].map((match) => ({ path: match[1], line: Number(match[2]), column: Number(match[3]) }));
}

function mapRecordForFrame(path, maps) {
  if (path.includes("/_astro/")) {
    const key = browserHash(path);
    return maps.find((candidate) => candidate.filenameHash === key);
  }
  const marker = path.indexOf("/dist/server/");
  if (marker < 0) return undefined;
  const displayPath = path.slice(marker + "/dist/".length);
  return maps.find(
    (candidate) => candidate.filenameHash === stablePathHash(displayPath),
  );
}

function resolvedRelativeSource(displayPath, source) {
  if (!source || source.startsWith("\0") || /^[a-zA-Z][a-zA-Z+.-]*:/.test(source)) {
    return null;
  }
  const value = posix
    .normalize(posix.join(posix.dirname(displayPath), source.replaceAll("\\", "/")))
    .replace(/^\/+/, "")
    .replace(/^(?:\.\.\/)+/, "");
  if (value === ".." || value.startsWith("../") || value.includes("/node_modules/")) {
    return null;
  }
  const srcAt = value.indexOf("src/");
  return srcAt >= 0 ? value.slice(srcAt) : value;
}

function resolveSource(event, expectedSuffix, maps) {
  for (const frame of frameCandidates(event.stack)) {
    const record = mapRecordForFrame(frame.path, maps);
    if (!record?.map || !record.displayPath) continue;
    const original = originalPositionFor(new TraceMap(JSON.parse(record.map)), {
      line: frame.line,
      column: Math.max(0, frame.column - 1),
    });
    const source = resolvedRelativeSource(record.displayPath, original.source);
    if (source?.endsWith(expectedSuffix) && original.line) return true;
  }
  throw new Error(
    `${event.message} did not resolve directly to ${expectedSuffix}: ${JSON.stringify({
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
  return run("docker", exactNodeContainerArgs(root, cell, env, ["npm", "run", "build"]));
}

async function startCell(root, cell, env) {
  const port = await availablePort();
  const origin = `http://127.0.0.1:${port}`;
  const runtimeEnv = { ...env, HOST: "127.0.0.1", PORT: String(port) };
  const child = exactNode
    ? spawn(
        "docker",
        exactNodeContainerArgs(root, cell, runtimeEnv, ["node", "dist/server/entry.mjs"]),
        { stdio: ["ignore", "pipe", "pipe"] },
      )
    : spawn(process.execPath, [join(root, "dist", "server", "entry.mjs")], {
        cwd: root,
        env: { ...process.env, ...runtimeEnv },
        stdio: ["ignore", "pipe", "pipe"],
      });
  let logs = "";
  child.stdout.on("data", (chunk) => (logs += chunk));
  child.stderr.on("data", (chunk) => (logs += chunk));
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Astro server exited early\n${logs}`);
    try {
      const response = await fetch(origin);
      if (response.status > 0) return { child, origin, logs: () => logs };
    } catch {}
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  child.kill("SIGTERM");
  throw new Error(`Astro server did not start\n${logs}`);
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
  const firstConfig = readFileSync(join(root, "astro.config.mjs"), "utf8");
  const firstManifest = readFileSync(join(root, ".volato", "manifest.json"), "utf8");
  await run(cli, ["errors", "init", "--yes"], { cwd: root, env: cliEnv });
  assert(
    readFileSync(join(root, "astro.config.mjs"), "utf8") === firstConfig,
    `${cell.id} config did not converge`,
  );
  assert(
    readFileSync(join(root, ".volato", "manifest.json"), "utf8") === firstManifest,
    `${cell.id} manifest did not converge`,
  );
  assert(
    existsSync(join(root, ".agents", "skills", "volato-astro", "SKILL.md")),
    `${cell.id} did not select the private Astro skill`,
  );
  const config = readFileSync(join(root, "astro.config.mjs"), "utf8");
  assert(
    config.includes("application-static-integration") &&
      config.includes("integrations: [applicationIntegration"),
    `${cell.id} lost the application integration or its leading array position`,
  );
  await buildCell(root, cell, {
    VOLATO_DSN: dsn,
    VITE_VOLATO_DSN: dsn,
    VITE_VOLATO_ENVIRONMENT: "production",
    VOLATO_INGEST_TOKEN: ingestToken,
    VOLATO_RELEASE: release,
  });
  const maps = state.maps.slice(mapStart);
  assert(maps.length >= 2, `${cell.id} did not upload both Astro map families`);
  assert(
    maps.every(
      (record) =>
        record.release === release && record.map && !record.raw.includes("sourcesContent"),
    ),
    `${cell.id} uploaded unsafe maps or mixed releases`,
  );
  assert(
    maps.some((record) => record.displayPath?.startsWith("_astro/")) &&
      maps.some((record) => record.displayPath?.startsWith("server/")),
    `${cell.id} did not upload client and final server maps`,
  );
  assert(
    allFiles(join(root, "dist")).every((path) => !path.endsWith(".map")),
    `${cell.id} left a private map in the deployable output`,
  );

  const runtime = await startCell(root, cell, { VOLATO_DSN: dsn, VOLATO_RELEASE: release });
  try {
    for (const path of ["/render-error?token=query-secret", "/api/boom?token=query-secret", "/middleware-error?token=query-secret"]) {
      const response = await fetch(`${runtime.origin}${path}`, {
        headers: {
          accept: "text/html",
          "x-request-id": "request-safe",
          "x-private-header": "private-header",
        },
      });
      const body = await response.text();
      assert(response.status === 500, `${cell.id} changed ${path} status to ${response.status}`);
      assert(body.includes("application-500"), `${cell.id} replaced the custom 500 page for ${path}`);
      if (!path.startsWith("/middleware-error")) {
        assert(
          response.headers.get("x-application-middleware") === "preserved",
          `${cell.id} lost application middleware headers for ${path}`,
        );
      }
    }
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.goto(`${runtime.origin}/?email=private@example.com`);
      await waitForEvents(eventStart, [
        `authored-browser:${cell.id}`,
        `authored-rejection:${cell.id}`,
      ]);
      await page.goto(`${runtime.origin}/server-island?email=private@example.com`);
      await waitForEvents(eventStart, [`server-island:${cell.id}`]);
      if (cell.renderer !== "core") {
        await page.goto(`${runtime.origin}/renderer?email=private@example.com`);
        await waitForEvents(eventStart, [`renderer-client:${cell.id}`]);
      }
    } finally {
      await browser.close();
    }
    await waitForEvents(eventStart, [
      `astro-render:${cell.id}`,
      `endpoint:${cell.id}`,
      `application-middleware:${cell.id}`,
    ]);
  } finally {
    await stopChild(runtime.child);
  }

  const expectedNames = [
    "authored-browser",
    "authored-rejection",
    "astro-render",
    "endpoint",
    "application-middleware",
    "server-island",
    ...(cell.renderer === "core" ? [] : ["renderer-client"]),
  ];
  const events = state.events.slice(eventStart).filter((event) =>
    String(event.message).endsWith(cell.id),
  );
  for (const name of expectedNames) {
    const count = events.filter((event) => event.message === `${name}:${cell.id}`).length;
    assert(
      name === "application-middleware" ? count >= 1 : count === 1,
      `${cell.id} did not emit the expected ${name} event count: ${JSON.stringify(
        events.map(({ message, capturedVia, runtime: eventRuntime }) => ({
          message,
          capturedVia,
          runtime: eventRuntime,
        })),
      )}`,
    );
  }
  const byMessage = Object.fromEntries(events.map((event) => [event.message, event]));
  assert(
    byMessage[`authored-browser:${cell.id}`].capturedVia === "window_error" &&
      byMessage[`authored-rejection:${cell.id}`].capturedVia === "unhandled_rejection",
    `${cell.id} lost authored browser ownership`,
  );
  for (const name of [
    "astro-render",
    "endpoint",
    "application-middleware",
    "server-island",
  ]) {
    const event = byMessage[`${name}:${cell.id}`];
    assert(
      event.capturedVia === "astro_middleware" && event.runtime === "node" && event.status === 500,
      `${cell.id} lost middleware ownership for ${name}`,
    );
  }
  if (cell.renderer !== "core") {
    const expectedOwner =
      cell.renderer === "vue"
        ? "vue_error_handler"
        : cell.renderer === "svelte"
          ? "astro_hydration_error"
          : "window_error";
    assert(
      byMessage[`renderer-client:${cell.id}`].capturedVia === expectedOwner,
      `${cell.id} misowned ${cell.renderer} hydration`,
    );
  }
  assert(
    events.every(
      (event) =>
        event.release === release &&
        !JSON.stringify(event).match(
          /query-secret|body-secret|private@example\.com|private-header|privateEmail/,
        ),
    ),
    `${cell.id} emitted unsafe request/component context or mixed release identity: ${JSON.stringify(
      events.map((event) => ({
        message: event.message,
        release: event.release,
        unsafe: JSON.stringify(event).match(
          /query-secret|body-secret|private@example\.com|private-header|privateEmail/,
        )?.[0],
        sample: JSON.stringify(event).match(
          /private@example\.com/,
        ) ? event : undefined,
      })),
    )}`,
  );
  assert(
    byMessage[`endpoint:${cell.id}`].route === "/api/boom" &&
      byMessage[`endpoint:${cell.id}`].method === "GET" &&
      byMessage[`endpoint:${cell.id}`].requestId === "request-safe",
    `${cell.id} lost bounded endpoint context`,
  );

  resolveSource(byMessage[`authored-browser:${cell.id}`], `src/client.${cell.language}`, maps);
  resolveSource(byMessage[`astro-render:${cell.id}`], "src/pages/render-error.astro", maps);
  resolveSource(byMessage[`endpoint:${cell.id}`], `src/pages/api/boom.${cell.language}`, maps);
  resolveSource(byMessage[`server-island:${cell.id}`], "src/components/DeferredError.astro", maps);
  if (cell.renderer !== "core") {
    const renderer = rendererFixtureMetadata(cell);
    resolveSource(byMessage[`renderer-client:${cell.id}`], renderer.clientSource, maps);
  }
}

function rendererFixtureMetadata(cell) {
  const extension = cell.language === "ts" ? "tsx" : "jsx";
  if (cell.renderer === "react") {
    return {
      clientSource: `src/components/Hydration.${extension}`,
    };
  }
  const suffix = cell.renderer === "vue" ? "vue" : "svelte";
  return {
    clientSource: `src/components/Hydration.${suffix}`,
  };
}

await new Promise((resolveListen, rejectListen) => {
  api.once("error", rejectListen);
  api.listen(0, "127.0.0.1", resolveListen);
});

let keepScratch = process.env.VOLATO_KEEP_CALIBRATION === "1";
try {
  assert(cells.length > 0, `No Astro calibration cell matches ${requestedCell ?? "the matrix"}`);
  const workspace = join(scratch, "workspace");
  mkdirSync(join(workspace, "apps"), { recursive: true });
  writeFileSync(join(workspace, "pnpm-workspace.yaml"), "packages:\n  - 'apps/*'\n");
  writeFileSync(join(workspace, ".npmrc"), "engine-strict=false\n");
  writeFileSync(join(workspace, "package.json"), '{"name":"astro-calibration","private":true}\n');
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
    state.integrations.filter((id) => id === "errors-astro").length === cells.length * 2,
    "Astro activation was not reported after both convergent setup runs",
  );
  process.stdout.write(
    `✓ ${cells.length} private Astro cells passed packed detection, convergent composition, exact-Node standalone production build, browser/server/island/renderer capture, privacy, lifecycle, direct source resolution and unresolved recovery boundaries\n`,
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
