import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
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
const scratch = mkdtempSync(join(tmpdir(), "volato-framework-stacks-"));
const authToken = "framework-stack-agent-token";
const ingestToken = "framework-stack-ingest-token";
const state = { events: [], maps: [], integrations: [] };

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
    let timedOut = false;
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, options.timeout ?? 180_000);
    child.once("error", (error) => {
      clearTimeout(timer);
      rejectRun(error);
    });
    child.once("close", (status) => {
      clearTimeout(timer);
      if ((status !== 0 || timedOut) && !options.allowFailure) {
        rejectRun(
          new Error(
            `${command} ${args.join(" ")} failed (${timedOut ? "timeout" : status})\n${stdout}\n${stderr}`,
          ),
        );
        return;
      }
      resolveRun({ stdout, stderr, status: timedOut ? 124 : status });
    });
  });
}

function allFiles(root) {
  if (!existsSync(root)) return [];
  return readdirSync(root).flatMap((name) => {
    const path = join(root, name);
    return statSync(path).isDirectory() ? allFiles(path) : [path];
  });
}

function digestFiles(root, paths) {
  const hash = createHash("sha256");
  for (const relative of paths.sort()) {
    const path = join(root, relative);
    hash.update(relative);
    hash.update(readFileSync(path));
  }
  return hash.digest("hex");
}

function installPackagedCli() {
  const host = join(scratch, "cli-host");
  const packDir = join(scratch, "pack");
  mkdirSync(host, { recursive: true });
  mkdirSync(packDir, { recursive: true });
  writeFileSync(join(host, "package.json"), '{"name":"cli-host","private":true}\n');
  execFileSync(
    "npm",
    [
      "pack",
      "--ignore-scripts",
      "--pack-destination",
      packDir,
      "--cache",
      join(scratch, "npm-cache"),
    ],
    { cwd: join(repositoryRoot, "packages", "cli"), stdio: "pipe" },
  );
  const archive = readdirSync(packDir).find((name) => name.endsWith(".tgz"));
  assert(archive, "npm pack produced no CLI archive");
  execFileSync(
    "npm",
    [
      "install",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      "--cache",
      join(scratch, "npm-cache"),
      join(packDir, archive),
    ],
    { cwd: host, stdio: "pipe" },
  );
  const cli = join(host, "node_modules", ".bin", "volato");
  assert(existsSync(cli), "packed CLI executable was not installed");
  return cli;
}

function writeVueFastifyFixture(root) {
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(
    join(root, "package.json"),
    `${JSON.stringify(
      {
        name: "volato-vue-fastify-conformance",
        private: true,
        type: "module",
        scripts: {
          build:
            "vite build && tsup src/server.ts --format esm --sourcemap --out-dir dist/server",
        },
        dependencies: {
          "@vitejs/plugin-vue": "6.0.8",
          fastify: "5.12.1",
          vite: "7.3.6",
          vue: "3.5.42",
        },
        devDependencies: {
          "@types/node": "24.10.0",
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
  writeFileSync(
    join(root, "index.html"),
    '<div id="app"></div><script type="module" src="/src/main.ts"></script>\n',
  );
  writeFileSync(
    join(root, "vite.config.ts"),
    'import { defineConfig } from "vite";\nimport vue from "@vitejs/plugin-vue";\nexport default defineConfig({ plugins: [vue()], build: { outDir: "dist/client" } });\n',
  );
  writeFileSync(
    join(root, "src", "App.vue"),
    "<template><main>Vue + Fastify conformance</main></template>\n",
  );
  writeFileSync(
    join(root, "src", "main.ts"),
    'import { createApp } from "vue";\nimport App from "./App.vue";\nconst app = createApp(App);\napp.mount("#app");\n',
  );
  writeFileSync(
    join(root, "src", "server.ts"),
    `import Fastify from "fastify";
const app = Fastify();
app.get("/health", async () => ({ ok: true }));
app.get("/boom", async () => { throw new Error("Vue Fastify combined failure"); });
if (process.argv.includes("--serve")) {
  await app.listen({ port: Number(process.env.PORT ?? 0), host: "127.0.0.1" });
  const address = app.server.address();
  if (address && typeof address === "object") console.log("READY:" + address.port);
}
export { app };
`,
  );
  writeFileSync(
    join(root, "src", "browser-conformance.test.ts"),
    `// @vitest-environment happy-dom
import { createApp } from "vue";
import { describe, expect, it } from "vitest";
import { initVolatoBrowser } from "./volato/browser";
import { installVolatoVue } from "./volato/vue";

describe("combined Vue browser capture", () => {
  it("captures Vue and browser-global failures", async () => {
    initVolatoBrowser({ dsn: process.env.VOLATO_TEST_DSN, environment: "production", release: process.env.VOLATO_RELEASE });
    const app = createApp({ render: () => null });
    installVolatoVue(app);
    app.config.errorHandler?.(new Error("Vue combined render failure"), null, "render function");
    window.dispatchEvent(new ErrorEvent("error", { error: new Error("Vue combined window failure") }));
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(app.config.errorHandler).toBeTypeOf("function");
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
          strict: true,
          skipLibCheck: true,
          types: ["vite/client", "node"],
        },
        include: ["src", "vite.config.ts"],
      },
      null,
      2,
    )}\n`,
  );
  writeFileSync(join(root, ".gitignore"), "node_modules/\ndist/\n.env*.local\n");
}

function writeSvelteNestFixture(root) {
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(
    join(root, "package.json"),
    `${JSON.stringify(
      {
        name: "volato-svelte-nest-conformance",
        private: true,
        scripts: { build: "vite build && nest build" },
        dependencies: {
          "@nestjs/common": "12.0.1",
          "@nestjs/core": "12.0.1",
          "@nestjs/platform-fastify": "12.0.1",
          "@sveltejs/vite-plugin-svelte": "6.2.4",
          fastify: "5.12.1",
          "reflect-metadata": "0.2.2",
          rxjs: "7.8.2",
          svelte: "5.56.10",
          vite: "7.3.6",
        },
        devDependencies: {
          "@nestjs/cli": "11.0.24",
          "@types/node": "24.10.0",
          "happy-dom": "20.10.6",
          typescript: "5.9.3",
          vitest: "3.2.7",
        },
      },
      null,
      2,
    )}\n`,
  );
  writeFileSync(
    join(root, "index.html"),
    '<div id="app"></div><script type="module" src="/src/main.tsx"></script>\n',
  );
  writeFileSync(
    join(root, "vite.config.ts"),
    'import { defineConfig } from "vite";\nimport { svelte } from "@sveltejs/vite-plugin-svelte";\nexport default defineConfig({ plugins: [svelte()], build: { outDir: "dist/client" } });\n',
  );
  writeFileSync(
    join(root, "src", "App.svelte"),
    "<main>Svelte + Nest conformance</main>\n",
  );
  writeFileSync(
    join(root, "src", "main.tsx"),
    'import { mount } from "svelte";\nimport App from "./App.svelte";\nconst app = mount(App, { target: document.getElementById("app")! });\nexport default app;\n',
  );
  writeFileSync(
    join(root, "src", "app.controller.ts"),
    `import { Controller, Get } from "@nestjs/common";
@Controller()
export class AppController {
  @Get("health") health() { return { ok: true }; }
  @Get("boom") boom() { throw new Error("Svelte Nest combined failure"); }
}
`,
  );
  writeFileSync(
    join(root, "src", "app.module.ts"),
    `import { Module } from "@nestjs/common";
import { AppController } from "./app.controller";
@Module({ controllers: [AppController] })
export class AppModule {}
`,
  );
  writeFileSync(
    join(root, "src", "main.ts"),
    `import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, NestFastifyApplication } from "@nestjs/platform-fastify";
import { AppModule } from "./app.module";
async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter());
  await app.listen(Number(process.env.PORT ?? 0), "127.0.0.1");
  const address = app.getHttpServer().address();
  if (address && typeof address === "object") console.log("READY:" + address.port);
}
void bootstrap();
`,
  );
  writeFileSync(
    join(root, "src", "browser-conformance.test.ts"),
    `// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { initVolatoBrowser } from "./volato/browser";
import { captureVolatoSvelteError } from "./volato/svelte";

describe("combined Svelte browser capture", () => {
  it("captures boundary and browser-global failures", async () => {
    initVolatoBrowser({ dsn: process.env.VOLATO_TEST_DSN, environment: "production", release: process.env.VOLATO_RELEASE });
    captureVolatoSvelteError(new Error("Svelte combined render failure"), () => {});
    const rejection = new Event("unhandledrejection");
    Object.defineProperty(rejection, "reason", { value: new Error("Svelte combined rejection") });
    window.dispatchEvent(rejection);
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(true).toBe(true);
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
          module: "CommonJS",
          moduleResolution: "Node",
          outDir: "dist/server",
          rootDir: "src",
          sourceMap: true,
          strict: true,
          skipLibCheck: true,
          experimentalDecorators: true,
          emitDecoratorMetadata: true,
          esModuleInterop: true,
        },
        include: ["src/main.ts", "src/app.module.ts", "src/app.controller.ts", "src/volato-node/**/*.ts"],
      },
      null,
      2,
    )}\n`,
  );
  writeFileSync(
    join(root, "tsconfig.build.json"),
    `${JSON.stringify({ extends: "./tsconfig.json", exclude: ["**/*.test.ts", "src/main.tsx", "src/volato/**"] }, null, 2)}\n`,
  );
  writeFileSync(
    join(root, "nest-cli.json"),
    `${JSON.stringify({ sourceRoot: "src", compilerOptions: { deleteOutDir: false, tsConfigPath: "tsconfig.build.json" } }, null, 2)}\n`,
  );
  writeFileSync(join(root, ".gitignore"), "node_modules/\ndist/\n.env*.local\n");
}

const api = createServer((request, response) => {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  if (request.method === "OPTIONS" && url.pathname === "/api/ingest") {
    response.writeHead(204, {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "POST, OPTIONS",
      "access-control-allow-headers": "Content-Type, X-Volato-DSN",
    });
    response.end();
    return;
  }
  const setup = url.pathname.match(/^\/v1\/projects\/([0-9a-f-]+)\/setup$/);
  if (request.method === "GET" && setup) {
    if (request.headers.authorization !== `Bearer ${authToken}`) {
      response.writeHead(401).end();
      return;
    }
    const address = api.address();
    const origin = `http://127.0.0.1:${address.port}`;
    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        data: {
          projectId: setup[1],
          projectName: "Framework stack conformance",
          dsn: `http://public@127.0.0.1:${address.port}/${setup[1]}`,
          ingestToken,
        },
      }),
    );
    return;
  }
  const linked = url.pathname.match(/^\/v1\/projects\/([0-9a-f-]+)\/linked$/);
  if (request.method === "POST" && linked) {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ data: { projectId: linked[1], linked: true } }));
    return;
  }
  const integration = url.pathname.match(
    /^\/v1\/projects\/([0-9a-f-]+)\/integrations\/(errors-[a-z-]+)$/,
  );
  if (request.method === "POST" && integration) {
    state.integrations.push({
      projectId: integration[1],
      integration: integration[2],
    });
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ data: { recorded: true } }));
    return;
  }
  if (request.method === "POST" && url.pathname === "/api/ingest") {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      state.events.push(JSON.parse(body));
      response.writeHead(202, {
        "content-type": "application/json",
        "access-control-allow-origin": "*",
      });
      response.end(JSON.stringify({ accepted: true }));
    });
    return;
  }
  if (request.method === "POST" && url.pathname === "/api/sourcemaps") {
    let body = Buffer.alloc(0);
    request.on("data", (chunk) => {
      body = Buffer.concat([body, chunk]);
    });
    request.on("end", () => {
      if (request.headers.authorization !== `Bearer ${ingestToken}`) {
        response.writeHead(401).end();
        return;
      }
      state.maps.push(body.toString("utf8"));
      response.writeHead(201, { "content-type": "application/json" });
      response.end(JSON.stringify({ stored: true }));
    });
    return;
  }
  response.writeHead(404).end();
});

async function waitForServer(child) {
  return new Promise((resolveReady, rejectReady) => {
    let output = "";
    const timeout = setTimeout(
      () => rejectReady(new Error(`server did not start:\n${output}`)),
      15_000,
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
    child.once("error", rejectReady);
    child.once("close", (status) => {
      if (!/READY:\d+/.test(output)) {
        clearTimeout(timeout);
        rejectReady(new Error(`server exited ${status}:\n${output}`));
      }
    });
  });
}

async function stopServer(child) {
  if (child.exitCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolveExit) => child.once("close", resolveExit)),
    new Promise((resolveWait) => setTimeout(resolveWait, 2_000)),
  ]);
  if (child.exitCode === null) child.kill("SIGKILL");
}

async function setupFixture({ cli, root, projectId, integrationIds, skills }) {
  await run("pnpm", ["install", "--ignore-scripts"], {
    cwd: root,
    timeout: 300_000,
  });
  const env = { VOLATO_API_URL: apiOrigin, VOLATO_TOKEN: authToken };
  await run(cli, ["init", "--project", projectId, "--yes"], { cwd: root, env });
  const setup = await run(cli, ["errors", "init", "--yes"], { cwd: root, env });
  assert(
    setup.stdout.includes("Volato Errors files are composed"),
    `setup did not report readiness:\n${setup.stdout}\n${setup.stderr}`,
  );
  const manifest = JSON.parse(readFileSync(join(root, ".volato", "manifest.json"), "utf8"));
  for (const integrationId of integrationIds) {
    assert(manifest.integrations[integrationId], `manifest is missing ${integrationId}`);
    assert(
      state.integrations.some(
        (entry) =>
          entry.projectId === projectId && entry.integration === integrationId,
      ),
      `activation is missing ${integrationId}`,
    );
  }
  for (const skill of skills) {
    assert(
      existsSync(join(root, ".agents", "skills", skill, "SKILL.md")),
      `packed setup did not install ${skill}`,
    );
  }
  const owned = [
    "package.json",
    "vite.config.ts",
    ".volato/manifest.json",
    ...allFiles(join(root, "src"))
      .map((path) => path.slice(root.length + 1))
      .filter((path) => !path.endsWith("browser-conformance.test.ts")),
  ];
  const before = digestFiles(root, owned);
  await run(cli, ["errors", "init", "--yes"], { cwd: root, env });
  assert(before === digestFiles(root, owned), "setup rerun changed composed files");
}

async function commitFixture(root, message) {
  if (!existsSync(join(root, ".git"))) {
    await run("git", ["init", "-q"], { cwd: root });
    await run("git", ["config", "user.name", "Volato Conformance"], { cwd: root });
    await run("git", ["config", "user.email", "conformance@volato.dev"], { cwd: root });
  }
  await run("git", ["add", "."], { cwd: root });
  await run("git", ["commit", "-qm", message], { cwd: root });
  return (await run("git", ["rev-parse", "HEAD"], { cwd: root })).stdout.trim();
}

async function buildAndCapture(config) {
  const mapStart = state.maps.length;
  const browserRelease = await commitFixture(config.root, `${config.label} browser release`);
  const dsn = `http://public@127.0.0.1:${api.address().port}/${config.projectId}`;
  await run("pnpm", ["exec", "vite", "build"], {
    cwd: config.root,
    env: {
      VITE_VOLATO_DSN: dsn,
      VOLATO_INGEST_TOKEN: ingestToken,
      VOLATO_RELEASE: browserRelease,
    },
  });
  assert(
    !allFiles(join(config.root, "dist", "client")).some((path) =>
      path.endsWith(".map"),
    ),
    `${config.label} left public browser sourcemaps`,
  );
  const browserBundle = allFiles(join(config.root, "dist", "client"))
    .filter((path) => path.endsWith(".js"))
    .map((path) => readFileSync(path, "utf8"))
    .join("\n");
  assert(!browserBundle.includes(ingestToken), `${config.label} leaked the ingest token`);

  writeFileSync(
    config.backendSource,
    `${readFileSync(config.backendSource, "utf8")}\n// independent backend release\n`,
  );
  const serverRelease = await commitFixture(config.root, `${config.label} backend release`);
  await run("pnpm", ["exec", ...config.backendBuild], {
    cwd: config.root,
    env: {
      VOLATO_DSN: dsn,
      VOLATO_INGEST_TOKEN: ingestToken,
      VOLATO_RELEASE: serverRelease,
    },
  });
  await run(
    process.execPath,
    ["src/volato-node/upload-sourcemaps.mjs", "dist/server"],
    {
      cwd: config.root,
      env: {
        VOLATO_DSN: dsn,
        VOLATO_INGEST_TOKEN: ingestToken,
        VOLATO_RELEASE: serverRelease,
      },
    },
  );
  const maps = state.maps.slice(mapStart);
  assert(maps.some((body) => body.includes(browserRelease)), `${config.label} browser release map is missing`);
  assert(maps.some((body) => body.includes(serverRelease)), `${config.label} backend release map is missing`);
  assert(maps.every((body) => !body.includes("sourcesContent")), `${config.label} uploaded source content`);
  assert(browserRelease !== serverRelease, `${config.label} did not prove independent releases`);

  const eventStart = state.events.length;
  await run("pnpm", ["exec", "vitest", "run", "src/browser-conformance.test.ts"], {
    cwd: config.root,
    env: { VOLATO_TEST_DSN: dsn, VOLATO_RELEASE: browserRelease },
  });
  const child = spawn(process.execPath, [config.serverArtifact, ...config.serverArgs], {
    cwd: config.root,
    env: {
      ...process.env,
      VOLATO_DSN: dsn,
      VOLATO_RELEASE: serverRelease,
      PORT: "0",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  try {
    const port = await waitForServer(child);
    const response = await fetch(
      `http://127.0.0.1:${port}/boom?email=private@example.com`,
      { headers: { authorization: "Bearer server-secret", "x-private": "hidden" } },
    );
    assert(response.status === 500, `${config.label} changed the HTTP 500 response`);
    await new Promise((resolveWait) => setTimeout(resolveWait, 150));
  } finally {
    await stopServer(child);
  }
  const events = state.events.slice(eventStart);
  const browserEvent = events.find(
    (event) => event.capturedVia === config.browserCapturedVia,
  );
  const serverEvents = events.filter(
    (event) => event.message === config.serverError,
  );
  assert(
    browserEvent?.runtime === "browser" && browserEvent.release === browserRelease,
    `${config.label} browser adapter did not preserve its release identity: ${JSON.stringify(events)}`,
  );
  assert(
    serverEvents.length === 1 &&
      serverEvents[0].runtime === "node" &&
      serverEvents[0].capturedVia === config.serverCapturedVia &&
      serverEvents[0].release === serverRelease &&
      serverEvents[0].route === "/boom",
    `${config.label} backend capture was missing or duplicated: ${JSON.stringify(events)}`,
  );
  const serialized = JSON.stringify(events);
  for (const secret of ["private@example.com", "server-secret", "hidden"]) {
    assert(!serialized.includes(secret), `${config.label} captured private request data`);
  }
}

let apiOrigin = "";

try {
  await new Promise((resolveListen, rejectListen) => {
    api.once("error", rejectListen);
    api.listen(0, "127.0.0.1", resolveListen);
  });
  apiOrigin = `http://127.0.0.1:${api.address().port}`;
  const cli = installPackagedCli();

  const vueRoot = join(scratch, "vue-fastify");
  writeVueFastifyFixture(vueRoot);
  await setupFixture({
    cli,
    root: vueRoot,
    projectId: "00000000-0000-4000-8000-000000000201",
    integrationIds: ["errors-browser-vue", "errors-node-fastify"],
    skills: ["volato-setup", "volato-vite-vue", "volato-fastify"],
  });
  await buildAndCapture({
    root: vueRoot,
    projectId: "00000000-0000-4000-8000-000000000201",
    label: "Vue + Fastify",
    backendSource: join(vueRoot, "src", "server.ts"),
    backendBuild: ["tsup", "src/server.ts", "--format", "esm", "--sourcemap", "--out-dir", "dist/server"],
    serverArtifact: join(vueRoot, "dist", "server", "server.js"),
    serverArgs: ["--serve"],
    browserCapturedVia: "vue_error_handler",
    serverCapturedVia: "fastify",
    serverError: "Vue Fastify combined failure",
  });
  process.stdout.write("✓ packed Vite + Vue and Fastify selected, built, mapped, and captured independently\n");

  const svelteRoot = join(scratch, "svelte-nest");
  writeSvelteNestFixture(svelteRoot);
  await setupFixture({
    cli,
    root: svelteRoot,
    projectId: "00000000-0000-4000-8000-000000000202",
    integrationIds: ["errors-browser-svelte", "errors-node-nestjs"],
    skills: ["volato-setup", "volato-vite-svelte", "volato-nestjs"],
  });
  await buildAndCapture({
    root: svelteRoot,
    projectId: "00000000-0000-4000-8000-000000000202",
    label: "Svelte + Nest",
    backendSource: join(svelteRoot, "src", "app.controller.ts"),
    backendBuild: ["nest", "build"],
    serverArtifact: join(svelteRoot, "dist", "server", "main.js"),
    serverArgs: [],
    browserCapturedVia: "svelte_boundary",
    serverCapturedVia: "nest_exception_filter",
    serverError: "Svelte Nest combined failure",
  });
  process.stdout.write("✓ packed Vite + Svelte and Nest/Fastify selected, built, mapped, and captured independently\n");
} finally {
  await new Promise((resolveClose) => api.close(resolveClose));
  if (process.env.VOLATO_KEEP_CONFORMANCE !== "1") {
    rmSync(scratch, { recursive: true, force: true });
  } else {
    process.stdout.write(`fixtures kept at ${scratch}\n`);
  }
}
