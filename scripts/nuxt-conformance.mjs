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
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { originalPositionFor, TraceMap } from "@jridgewell/trace-mapping";
import { chromium } from "playwright";
import { runtimeMatrix } from "./errors-runtime-matrix.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const scratch = mkdtempSync(join(tmpdir(), "volato-nuxt-calibration-"));
const projectId = "00000000-0000-4000-8000-000000000240";
const groupId = "00000000-0000-4000-8000-000000000241";
const authToken = "nuxt-calibration-workspace-token";
const ingestToken = "nuxt-calibration-ingest-token";
const requestedCell = process.argv.find((arg) => arg.startsWith("--cell="))?.slice(7);
const exactNode =
  process.argv.includes("--exact-node") || process.env.VOLATO_NUXT_EXACT_NODE === "1";
const cells = runtimeMatrix.cells.filter(
  (cell) =>
    cell.family === "nuxt-nitro" &&
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
  writeFileSync(join(host, "package.json"), '{"name":"nuxt-cli-host","private":true}\n');
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

function writeFixture(root, cell) {
  const configExtension = cell.config.split(".").at(-1);
  mkdirSync(join(root, "app", "pages"), { recursive: true });
  mkdirSync(join(root, "app", "plugins"), { recursive: true });
  mkdirSync(join(root, "server", "api", "boom"), { recursive: true });
  mkdirSync(join(root, "server", "plugins"), { recursive: true });
  writeFileSync(
    join(root, "package.json"),
    `${JSON.stringify(
      {
        name: cell.id,
        private: true,
        type: "module",
        engines: { node: cell.node },
        scripts: { build: "nuxt build" },
        dependencies: {
          nuxt: cell.nuxt,
          vue: cell.vue,
          "vue-router": cell.vueRouter,
        },
      },
      null,
      2,
    )}\n`,
  );
  writeFileSync(join(root, ".node-version"), `${cell.node}\n`);
  writeFileSync(join(root, ".gitignore"), "node_modules/\n.nuxt/\n.output/\n.env*.local\n");
  writeFileSync(
    join(root, `nuxt.config.${configExtension}`),
    `export default defineNuxtConfig({
  compatibilityDate: "2026-08-28",
  devtools: { enabled: false },
  nitro: { preset: "node-server" },
});
`,
  );
  writeFileSync(
    join(root, "tsconfig.json"),
    '{"files":[],"references":[{"path":"./.nuxt/tsconfig.app.json"},{"path":"./.nuxt/tsconfig.server.json"}]}\n',
  );
  writeFileSync(
    join(root, "app", "app.vue"),
    "<template><NuxtPage /></template>\n",
  );
  writeFileSync(
    join(root, "app", "error.vue"),
    `<script setup lang="ts">defineProps<{ error: { statusCode?: number } }>();</script>
<template><main id="application-error">Application-owned error page</main></template>
`,
  );
  writeFileSync(
    join(root, "app", "plugins", "10.application.client.ts"),
    `export default defineNuxtPlugin({
  name: "application-observer",
  hooks: {
    "vue:error": (error) => {
      const target = window as Window & { __applicationNuxtErrors?: string[] };
      target.__applicationNuxtErrors ??= [];
      target.__applicationNuxtErrors.push(error instanceof Error ? error.message : String(error));
    },
    "app:error": (error) => {
      const target = window as Window & { __applicationNuxtErrors?: string[] };
      target.__applicationNuxtErrors ??= [];
      target.__applicationNuxtErrors.push(error instanceof Error ? error.message : String(error));
    },
  },
});
`,
  );
  writeFileSync(
    join(root, "app", "pages", "index.vue"),
    `<script setup lang="ts">
const shouldFail = ref(false);
const renderFailure = new Error("render:${cell.id}");
const nuxtApp = useNuxtApp();
onMounted(async () => {
  window.dispatchEvent(new ErrorEvent("error", { error: new Error("window:${cell.id}") }));
  window.dispatchEvent(new PromiseRejectionEvent("unhandledrejection", {
    promise: Promise.resolve(),
    reason: new Error("rejection:${cell.id}"),
  }));
  const appFailure = Object.assign(new Error("app:${cell.id}"), { unhandled: true });
  await nuxtApp.callHook("app:error", appFailure);
  setTimeout(() => { shouldFail.value = true; }, 0);
});
const output = computed(() => {
  if (shouldFail.value) throw renderFailure;
  return "Nuxt calibration ready";
});
</script>
<template><main id="ready">{{ output }}</main></template>
`,
  );
  writeFileSync(
    join(root, "app", "pages", "ssr.vue"),
    `<script setup lang="ts">
if (import.meta.server) throw new Error("ssr:${cell.id}");
</script>
<template><main>SSR route</main></template>
`,
  );
  writeFileSync(
    join(root, "app", "pages", "expected.vue"),
    `<script setup lang="ts">
throw createError({ statusCode: 418, statusMessage: "Expected page outcome" });
</script>
<template><main>Expected</main></template>
`,
  );
  writeFileSync(
    join(root, "server", "api", "boom", "[id].get.ts"),
    `export default defineEventHandler(() => {
  throw new Error("nitro:${cell.id}");
});
`,
  );
  writeFileSync(
    join(root, "server", "api", "expected.get.ts"),
    `export default defineEventHandler(() => {
  throw createError({ statusCode: 418, statusMessage: "Expected API outcome" });
});
`,
  );
  writeFileSync(
    join(root, "server", "api", "startup-probe.get.ts"),
    `export default defineEventHandler(async () => {
  await useNitroApp().hooks.callHook("error", new Error("startup:${cell.id}"), {});
  return { ok: true };
});
`,
  );
  writeFileSync(
    join(root, "server", "plugins", "10.application.ts"),
    `export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook("error", (error) => {
    console.log("[application-nitro-hook]", error instanceof Error ? error.message : String(error));
  });
});
`,
  );
}

function multipartField(body, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(
    `name="${escaped}"(?:; filename="[^"]+")?\\r\\n(?:Content-Type:[^\\r]+\\r\\n)?\\r\\n([\\s\\S]*?)\\r\\n--`,
  ).exec(body)?.[1];
}

const state = {
  events: [],
  integrations: [],
  maps: [],
  context: null,
};

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
      projectName: "Nuxt calibration",
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

function frameCandidates(stack) {
  return [
    ...String(stack ?? "").matchAll(
      /((?:https?:\/\/|file:\/\/\/)[^\s)]+?\.(?:mjs|js)):(\d+):(\d+)/g,
    ),
  ].map((match) => ({ path: match[1], line: Number(match[2]), column: Number(match[3]) }));
}

function mapKeyForFrame(path) {
  if (path.includes("/_nuxt/")) {
    const stem = basename(new URL(path).pathname).replace(/\.(?:mjs|js)$/, "");
    if (!stem.includes(".") && /^[a-zA-Z0-9_-]{8,32}$/.test(stem)) {
      return stem;
    }
    return stem
      .split(".")
      .reverse()
      .find((part) => /^[a-zA-Z0-9_-]{8,32}$/.test(part));
  }
  const marker = path.indexOf("/.output/");
  if (marker < 0) return undefined;
  const displayPath = path.slice(marker + "/.output/".length);
  return stablePathHash(displayPath);
}

function resolveSource(event, expectedSuffix, maps) {
  for (const frame of frameCandidates(event.stack)) {
    const key = mapKeyForFrame(frame.path);
    const record = maps.find((candidate) => candidate.filenameHash === key);
    if (!record?.map) continue;
    const original = originalPositionFor(new TraceMap(JSON.parse(record.map)), {
      line: frame.line,
      column: Math.max(0, frame.column - 1),
    });
    if (original.source?.replaceAll("\\", "/").endsWith(expectedSuffix) && original.line) {
      return {
        original_path: expectedSuffix,
        original_line: original.line,
        original_column: original.column ?? 0,
      };
    }
  }
  throw new Error(`${event.message} did not resolve to ${expectedSuffix}`);
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

async function startNuxt(root, env) {
  const port = await availablePort();
  const child = spawn(process.execPath, [join(root, ".output", "server", "index.mjs")], {
    cwd: root,
    env: { ...process.env, ...env, HOST: "127.0.0.1", PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let logs = "";
  child.stdout.on("data", (chunk) => (logs += chunk));
  child.stderr.on("data", (chunk) => (logs += chunk));
  const origin = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Nuxt server exited early\n${logs}`);
    try {
      const response = await fetch(`${origin}/__nuxt_ready__`);
      if (response.status > 0) return { child, origin, logs: () => logs };
    } catch {}
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  child.kill("SIGTERM");
  throw new Error(`Nuxt server did not start\n${logs}`);
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
  if (!exactNode) return startNuxt(root, env);
  const port = await availablePort();
  const child = spawn(
    "docker",
    exactNodeContainerArgs(
      root,
      cell,
      { ...env, HOST: "127.0.0.1", PORT: String(port) },
      ["node", ".output/server/index.mjs"],
    ),
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  let logs = "";
  child.stdout.on("data", (chunk) => (logs += chunk));
  child.stderr.on("data", (chunk) => (logs += chunk));
  const origin = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Nuxt container exited early\n${logs}`);
    try {
      const response = await fetch(`${origin}/__nuxt_ready__`);
      if (response.status > 0) return { child, origin, logs: () => logs };
    } catch {}
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  child.kill("SIGTERM");
  throw new Error(`Nuxt container did not start\n${logs}`);
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

async function waitForEvents(start, messages, timeout = 12_000) {
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
  const mapStart = state.maps.length;
  const eventStart = state.events.length;
  await run(cli, ["init", "--project", projectId, "--yes"], {
    cwd: root,
    env: { VOLATO_API_URL: apiOrigin, VOLATO_TOKEN: authToken },
  });
  await run(cli, ["errors", "init", "--yes"], {
    cwd: root,
    env: { VOLATO_API_URL: apiOrigin, VOLATO_TOKEN: authToken },
  });
  const configPath = join(root, cell.config);
  const firstConfig = readFileSync(configPath, "utf8");
  const firstManifest = readFileSync(join(root, ".volato", "manifest.json"), "utf8");
  await run(cli, ["errors", "init", "--yes"], {
    cwd: root,
    env: { VOLATO_API_URL: apiOrigin, VOLATO_TOKEN: authToken },
  });
  assert(readFileSync(configPath, "utf8") === firstConfig, `${cell.id} config did not converge`);
  assert(
    readFileSync(join(root, ".volato", "manifest.json"), "utf8") === firstManifest,
    `${cell.id} manifest did not converge`,
  );
  assert(
    existsSync(join(root, ".agents", "skills", "volato-nuxt", "SKILL.md")),
    `${cell.id} did not select the Nuxt skill`,
  );
  await buildCell(root, cell, {
    VOLATO_DSN: `${apiOrigin.replace("http://", "http://public@")}/${projectId}`,
    VOLATO_INGEST_TOKEN: ingestToken,
    VOLATO_RELEASE: release,
  });
  const maps = state.maps.slice(mapStart);
  assert(maps.length > 1, `${cell.id} uploaded neither client nor server maps`);
  assert(
    maps.every(
      (record) =>
        record.release === release &&
        record.map &&
        !record.raw.includes("sourcesContent"),
    ),
    `${cell.id} uploaded unsafe maps or mixed releases`,
  );
  assert(
    maps.some((record) => record.displayPath?.startsWith("_nuxt/")) &&
      maps.some((record) => record.displayPath?.startsWith("server/")),
    `${cell.id} did not upload both Nuxt artifact families`,
  );
  assert(
    allFiles(join(root, ".output")).every((path) => !path.endsWith(".map")),
    `${cell.id} left deployable sourcemaps`,
  );

  const runtime = await startCell(root, cell, {
    VOLATO_DSN: `${apiOrigin.replace("http://", "http://public@")}/${projectId}`,
    VOLATO_RELEASE: release,
  });
  let applicationClientErrors = [];
  try {
    const expectedBefore = state.events.length;
    const expectedApi = await fetch(`${runtime.origin}/api/expected`);
    const expectedPage = await fetch(`${runtime.origin}/expected`, {
      headers: { accept: "text/html" },
    });
    assert(expectedApi.status === 418, `${cell.id} changed handled API status`);
    assert(expectedPage.status === 418, `${cell.id} changed handled page status`);
    await new Promise((resolveWait) => setTimeout(resolveWait, 250));
    assert(state.events.length === expectedBefore, `${cell.id} captured handled Nuxt errors`);

    const ssr = await fetch(`${runtime.origin}/ssr`, {
      headers: { accept: "text/html" },
    });
    const ssrBody = await ssr.text();
    assert(ssr.status === 500, `${cell.id} changed SSR failure status`);
    assert(ssrBody.includes("Application-owned error page"), `${cell.id} replaced error.vue`);
    const nitro = await fetch(
      `${runtime.origin}/api/boom/private-account?token=query-secret`,
    );
    assert(nitro.status === 500, `${cell.id} changed Nitro failure status`);
    const startup = await fetch(`${runtime.origin}/api/startup-probe`);
    assert(startup.status === 200, `${cell.id} changed lifecycle hook response`);

    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.goto(`${runtime.origin}/?email=private@example.com`);
      await waitForEvents(eventStart, [
        `window:${cell.id}`,
        `rejection:${cell.id}`,
        `app:${cell.id}`,
        `render:${cell.id}`,
      ]);
      applicationClientErrors = await page.evaluate(
        () => window.__applicationNuxtErrors ?? [],
      );
    } finally {
      await browser.close();
    }
    await waitForEvents(eventStart, [
      `ssr:${cell.id}`,
      `nitro:${cell.id}`,
      `startup:${cell.id}`,
    ]);
  } finally {
    await stopChild(runtime.child);
  }

  const events = state.events.slice(eventStart).filter((event) =>
    String(event.message).endsWith(cell.id),
  );
  for (const message of ["window", "rejection", "app", "render", "ssr", "nitro", "startup"]) {
    assert(
      events.filter((event) => event.message === `${message}:${cell.id}`).length === 1,
      `${cell.id} did not emit exactly one ${message} event`,
    );
  }
  const byMessage = Object.fromEntries(events.map((event) => [event.message, event]));
  assert(byMessage[`window:${cell.id}`].capturedVia === "window_error", `${cell.id} lost window identity`);
  assert(
    byMessage[`rejection:${cell.id}`].capturedVia === "unhandled_rejection",
    `${cell.id} lost rejection identity`,
  );
  assert(
    byMessage[`app:${cell.id}`].capturedVia === "nuxt_app_error" &&
      byMessage[`render:${cell.id}`].capturedVia === "nuxt_app_error",
    `${cell.id} lost Nuxt client identity`,
  );
  for (const message of ["ssr", "nitro", "startup"]) {
    assert(
      byMessage[`${message}:${cell.id}`].capturedVia === "nitro_error" &&
        byMessage[`${message}:${cell.id}`].runtime === "node",
      `${cell.id} lost Nitro identity for ${message}`,
    );
  }
  assert(
    byMessage[`nitro:${cell.id}`].route === "/api/boom/:id" &&
      byMessage[`nitro:${cell.id}`].method === "GET",
    `${cell.id} lost normalized Nitro request context`,
  );
  assert(
    events.every(
      (event) =>
        event.release === release &&
        !JSON.stringify(event).match(
          /private-account|query-secret|private@example\.com|private-header|private-payload/,
        ),
    ),
    `${cell.id} emitted unsafe context or mixed release identity`,
  );
  assert(
    applicationClientErrors.includes(`app:${cell.id}`) &&
      applicationClientErrors.includes(`render:${cell.id}`),
    `${cell.id} did not preserve application-owned client hooks`,
  );
  assert(
    runtime.logs().includes("[application-nitro-hook]"),
    `${cell.id} did not preserve application-owned Nitro hooks`,
  );

  const renderSource = resolveSource(
    byMessage[`render:${cell.id}`],
    "app/pages/index.vue",
    maps,
  );
  resolveSource(byMessage[`ssr:${cell.id}`], "app/pages/ssr.vue", maps);
  resolveSource(
    byMessage[`nitro:${cell.id}`],
    "server/api/boom/[id].get.ts",
    maps,
  );
  state.context = {
    group: {
      id: groupId,
      projectId,
      projectName: "Nuxt calibration",
      fingerprint: `nuxt:${cell.id}`,
      message: `render:${cell.id}`,
      severity: "error",
      status: "unresolved",
      eventCount: 1,
      matchingEventCount: 1,
      affectedUserCount: 0,
      firstSeen: "2026-08-28T10:00:00.000Z",
      lastSeen: "2026-08-28T10:00:00.000Z",
      firstMatchedAt: "2026-08-28T10:00:00.000Z",
      lastMatchedAt: "2026-08-28T10:00:00.000Z",
      runtimes: ["browser"],
      routes: ["/"],
      releases: [release],
      baselineEventCount: 0,
      growthDelta: 1,
      growthRatio: null,
    },
    events: [byMessage[`render:${cell.id}`]],
    commitTransition: null,
    resolvedFrame: renderSource,
    resolutionState: "unresolved",
    history: [],
    affectedUsers: { count: 0 },
    similarResolved: [],
  };
  const context = await run(
    cli,
    ["errors", "show", groupId, "--project-id", projectId, "--json"],
    { cwd: root, env: { VOLATO_API_URL: apiOrigin, VOLATO_TOKEN: authToken } },
  );
  const parsed = JSON.parse(context.stdout);
  assert(
    parsed.data?.resolvedFrame?.original_path === "app/pages/index.vue" &&
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
  assert(cells.length > 0, `No Nuxt calibration cell matches ${requestedCell ?? "the matrix"}`);
  const workspace = join(scratch, "workspace");
  mkdirSync(join(workspace, "apps"), { recursive: true });
  writeFileSync(join(workspace, "pnpm-workspace.yaml"), "packages:\n  - 'apps/*'\n");
  writeFileSync(join(workspace, ".npmrc"), "engine-strict=false\n");
  writeFileSync(join(workspace, "package.json"), '{"name":"nuxt-calibration","private":true}\n');
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
    state.integrations.filter((id) => id === "errors-nuxt").length === cells.length * 2,
    "Nuxt integration activation was not reported after both convergent setup runs",
  );
  process.stdout.write(
    `✓ ${cells.length} supported Nuxt cells passed packed detection, convergent generation, ${exactNode ? "exact-Node " : ""}production build, browser/SSR/Nitro capture, handled-error silence, privacy, lifecycle, client/server source resolution and CLI retrieval\n`,
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
