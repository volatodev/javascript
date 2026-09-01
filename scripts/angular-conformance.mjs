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
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { originalPositionFor, TraceMap } from "@jridgewell/trace-mapping";
import { chromium } from "playwright";
import { runtimeMatrix } from "./errors-runtime-matrix.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const scratch = mkdtempSync(join(tmpdir(), "volato-angular-calibration-"));
const projectId = "00000000-0000-4000-8000-000000000220";
const groupId = "00000000-0000-4000-8000-000000000221";
const authToken = "angular-calibration-workspace-token";
const ingestToken = "angular-calibration-ingest-token";
const requestedCell = process.argv.find((arg) => arg.startsWith("--cell="))?.slice(7);
const cells = runtimeMatrix.cells.filter(
  (cell) =>
    cell.family === "browser-angular" &&
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
  writeFileSync(join(host, "package.json"), '{"name":"angular-cli-host","private":true}\n');
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
  const major = cell.angular.split(".")[0];
  const zone = cell.changeDetection === "zonejs";
  mkdirSync(join(root, "src", "app"), { recursive: true });
  writeFileSync(
    join(root, "package.json"),
    `${JSON.stringify(
      {
        name: cell.id,
        private: true,
        scripts: { build: "ng build" },
        dependencies: {
          "@angular/common": cell.angular,
          "@angular/compiler": cell.angular,
          "@angular/core": cell.angular,
          "@angular/platform-browser": cell.angular,
          rxjs: "7.8.2",
          tslib: "2.8.1",
          ...(zone ? { "zone.js": "0.15.1" } : {}),
        },
        devDependencies: {
          "@angular/build": cell.adapterVersion,
          "@angular/cli": cell.adapterVersion,
          "@angular/compiler-cli": cell.angular,
          typescript: major === "22" ? "6.0.2" : "5.9.2",
        },
      },
      null,
      2,
    )}\n`,
  );
  writeFileSync(
    join(root, "angular.json"),
    `${JSON.stringify(
      {
        $schema: "./node_modules/@angular/cli/lib/config/schema.json",
        version: 1,
        projects: {
          "calibration-app": {
            projectType: "application",
            root: "",
            sourceRoot: "src",
            prefix: "app",
            architect: {
              build: {
                builder: "@angular/build:application",
                options: {
                  browser: "src/main.ts",
                  ...(zone ? { polyfills: ["zone.js"] } : {}),
                  tsConfig: "tsconfig.app.json",
                  styles: ["src/styles.css"],
                },
                configurations: {
                  production: { outputHashing: "all" },
                  development: { optimization: false, sourceMap: true },
                },
                defaultConfiguration: "production",
              },
            },
          },
        },
      },
      null,
      2,
    )}\n`,
  );
  writeFileSync(
    join(root, "tsconfig.json"),
    `${JSON.stringify(
      {
        compilerOptions: {
          target: "ES2022",
          module: "preserve",
          moduleResolution: "bundler",
          strict: true,
          skipLibCheck: true,
          experimentalDecorators: true,
          useDefineForClassFields: false,
        },
        angularCompilerOptions: { strictTemplates: true },
      },
      null,
      2,
    )}\n`,
  );
  writeFileSync(
    join(root, "tsconfig.app.json"),
    `${JSON.stringify(
      {
        extends: "./tsconfig.json",
        compilerOptions: { outDir: "./out-tsc/app", types: [] },
        files: ["src/main.ts"],
      },
      null,
      2,
    )}\n`,
  );
  writeFileSync(
    join(root, "src", "index.html"),
    '<!doctype html><html><head><meta charset="utf-8"><base href="/"></head><body><app-root></app-root></body></html>\n',
  );
  writeFileSync(join(root, "src", "styles.css"), "body { font-family: sans-serif; }\n");
  writeFileSync(
    join(root, "src", "main.ts"),
    `import { bootstrapApplication } from "@angular/platform-browser";
import { appConfig } from "./app/app.config";
import { App } from "./app/app";

bootstrapApplication(App, appConfig).catch((error) => console.error(error));
`,
  );
  const zonelessProvider =
    major === "20" && !zone
      ? ", provideZonelessChangeDetection"
      : "";
  const zonelessCall =
    major === "20" && !zone
      ? "    provideZonelessChangeDetection(),\n"
      : "";
  writeFileSync(
    join(root, "src", "app", "app.config.ts"),
    `import { ApplicationConfig, ErrorHandler, provideBrowserGlobalErrorListeners${zonelessProvider} } from "@angular/core";

class ApplicationErrorHandler implements ErrorHandler {
  handleError(error: unknown): void {
    const target = window as Window & { __volatoOriginalErrors?: string[] };
    target.__volatoOriginalErrors ??= [];
    target.__volatoOriginalErrors.push(error instanceof Error ? error.message : String(error));
    console.error("application-owned", error);
  }
}

export const appConfig: ApplicationConfig = {
  providers: [
${zonelessCall}    provideBrowserGlobalErrorListeners(),
    { provide: ErrorHandler, useClass: ApplicationErrorHandler },
  ],
};
`,
  );
  writeFileSync(
    join(root, "src", "app", "app.ts"),
    `import { Component, OnInit, signal } from "@angular/core";
import { captureBrowserError } from "../volato/browser";

@Component({
  selector: "app-root",
  standalone: true,
  template: "<main>{{ renderValue() }}</main>",
})
export class App implements OnInit {
  private readonly shouldFail = signal(false);
  private readonly renderFailure = new Error("render:${cell.id}");
  private readonly privateMarker = "private@example.com";

  ngOnInit(): void {
    void captureBrowserError(new Error("manual:${cell.id}"));
    window.dispatchEvent(new ErrorEvent("error", {
      error: new Error("window:${cell.id}"),
    }));
    window.dispatchEvent(new PromiseRejectionEvent("unhandledrejection", {
      promise: Promise.resolve(),
      reason: new Error("rejection:${cell.id}"),
    }));
    setTimeout(() => this.shouldFail.set(true), 0);
  }

  renderValue(): string {
    if (this.shouldFail()) throw this.renderFailure;
    return "Volato Angular calibration";
  }
}
`,
  );
  writeFileSync(join(root, ".gitignore"), "node_modules/\ndist/\n.env*.local\n");
}

function multipartField(body, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(
    `name="${escaped}"(?:; filename="[^"]+")?\\r\\n(?:Content-Type:[^\\r]+\\r\\n)?\\r\\n([\\s\\S]*?)\\r\\n--`,
  ).exec(body)?.[1];
}

const state = {
  events: [],
  groups: new Map(),
  integrations: [],
  maps: [],
  context: null,
};

function json(response, data, status = 200, markdown = "") {
  response.writeHead(status, {
    "content-type": "application/json",
    "access-control-allow-origin": "*",
  });
  response.end(JSON.stringify(status >= 200 && status < 300 ? { markdown, data } : { error: data }));
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
      projectName: "Angular calibration",
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
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      const event = JSON.parse(body);
      state.events.push(event);
      const key = `${event.runtime}:${event.type}:${event.message}`;
      state.groups.set(key, [...(state.groups.get(key) ?? []), event]);
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
    request.on("data", (chunk) => {
      body = Buffer.concat([body, chunk]);
    });
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
    if (!state.context) {
      json(response, null, 404);
      return;
    }
    json(
      response,
      state.context,
      200,
      `# ${state.context.group.message}\n\n**Status:** unresolved\n**Source:** ${state.context.resolvedFrame.original_path}:${state.context.resolvedFrame.original_line}\n`,
    );
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

const contentTypes = {
  ".css": "text/css",
  ".html": "text/html",
  ".js": "text/javascript",
  ".json": "application/json",
};

function serveDist(root) {
  const server = createServer((request, response) => {
    const pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
    const relative = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
    const path = join(root, relative);
    if (!path.startsWith(root) || !existsSync(path) || statSync(path).isDirectory()) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, {
      "content-type": contentTypes[extname(path)] ?? "application/octet-stream",
    });
    response.end(readFileSync(path));
  });
  return new Promise((resolveServer, rejectServer) => {
    server.once("error", rejectServer);
    server.listen(0, "127.0.0.1", () => resolveServer(server));
  });
}

function resolveSource(cell, release, events) {
  const maps = state.maps.filter((map) => map.release === release);
  assert(maps.length > 0, `${cell.id} uploaded no map`);
  assert(
    maps.every((record) => record.map && !record.raw.includes("sourcesContent")),
    `${cell.id} uploaded source content`,
  );
  const event = events.find((candidate) => candidate.message === `render:${cell.id}`);
  assert(event, `${cell.id} emitted no Angular render error`);
  const frames = [
    ...String(event.stack ?? "").matchAll(
      /https?:\/\/[^\s)]+?-([a-zA-Z0-9_-]{8,20})\.js:(\d+):(\d+)/g,
    ),
  ];
  for (const frame of frames) {
    const record = maps.find((candidate) => candidate.filenameHash === frame[1]);
    if (!record?.map) continue;
    const original = originalPositionFor(new TraceMap(JSON.parse(record.map)), {
      line: Number(frame[2]),
      column: Number(frame[3]),
    });
    if (original.source?.endsWith("src/app/app.ts") && original.line) {
      return {
        original_path: "src/app/app.ts",
        original_line: original.line,
        original_column: original.column ?? 0,
      };
    }
  }
  throw new Error(`${cell.id} did not resolve its Angular frame to src/app/app.ts`);
}

async function exerciseCell(cli, root, cell, apiOrigin) {
  const release = `${cell.id.replaceAll(".", "-")}-release`;
  const beforeMaps = state.maps.length;
  const beforeEvents = state.events.length;
  await run(cli, ["init", "--project", projectId, "--yes"], {
    cwd: root,
    env: { VOLATO_API_URL: apiOrigin, VOLATO_TOKEN: authToken },
  });
  await run(cli, ["errors", "init", "--yes"], {
    cwd: root,
    env: { VOLATO_API_URL: apiOrigin, VOLATO_TOKEN: authToken },
  });
  await run("pnpm", ["build"], {
    cwd: root,
    env: {
      VOLATO_DSN: `${apiOrigin.replace("http://", "http://public@")}/${projectId}`,
      VOLATO_INGEST_TOKEN: ingestToken,
      VOLATO_RELEASE: release,
    },
  });
  assert(state.maps.length > beforeMaps, `${cell.id} uploaded no sourcemap`);
  const outputRoot = join(root, "dist", "calibration-app");
  assert(
    allFiles(outputRoot).every((path) => !path.endsWith(".map")),
    `${cell.id} left a public sourcemap`,
  );
  const browserRoot = existsSync(join(outputRoot, "browser"))
    ? join(outputRoot, "browser")
    : outputRoot;
  const staticServer = await serveDist(browserRoot);
  const browser = await chromium.launch({ headless: true });
  let originalErrors = [];
  try {
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${staticServer.address().port}/?email=private@example.com`);
    const deadline = Date.now() + 10_000;
    while (
      state.events
        .slice(beforeEvents)
        .filter((event) => String(event.message).endsWith(cell.id)).length < 4 &&
      Date.now() < deadline
    ) {
      await new Promise((resolveWait) => setTimeout(resolveWait, 50));
    }
    originalErrors = await page.evaluate(
      () => window.__volatoOriginalErrors ?? [],
    );
  } finally {
    await browser.close();
    await new Promise((resolveClose) => staticServer.close(resolveClose));
  }
  const events = state.events
    .slice(beforeEvents)
    .filter((event) => String(event.message).endsWith(cell.id));
  const captures = Object.fromEntries(
    events.map((event) => [event.message.split(":")[0], event.capturedVia]),
  );
  assert(events.length === 4, `${cell.id} emitted ${events.length}/4 bounded events`);
  assert(captures.manual === "manual", `${cell.id} lost manual capture identity`);
  assert(captures.window === "window_error", `${cell.id} lost window capture identity`);
  assert(
    captures.rejection === "unhandled_rejection",
    `${cell.id} lost rejection capture identity`,
  );
  assert(
    captures.render === "angular_error_handler",
    `${cell.id} lost Angular ErrorHandler identity`,
  );
  assert(
    originalErrors.includes(`render:${cell.id}`),
    `${cell.id} did not preserve the application-owned ErrorHandler`,
  );
  assert(
    events.every(
      (event) =>
        event.runtime === "browser" &&
        event.route === "/" &&
        !JSON.stringify(event).includes("private@example.com"),
    ),
    `${cell.id} emitted unsafe or unnormalized browser context`,
  );
  const resolvedFrame = resolveSource(cell, release, events);
  const renderEvent = events.find((event) => event.message === `render:${cell.id}`);
  const grouped = state.groups.get(`browser:Error:render:${cell.id}`) ?? [];
  assert(grouped.length === 1, `${cell.id} did not form one stable local group`);
  state.context = {
    group: {
      id: groupId,
      projectId,
      projectName: "Angular calibration",
      fingerprint: `angular:${cell.id}`,
      message: renderEvent.message,
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
    events: [renderEvent],
    commitTransition: null,
    resolvedFrame,
    resolutionState: "unresolved",
    history: [],
    affectedUsers: { count: 0 },
    similarResolved: [],
  };
  const context = await run(
    cli,
    ["errors", "show", groupId, "--project-id", projectId, "--json"],
    {
      cwd: root,
      env: { VOLATO_API_URL: apiOrigin, VOLATO_TOKEN: authToken },
    },
  );
  const parsed = JSON.parse(context.stdout);
  assert(
    parsed.data?.resolvedFrame?.original_path === "src/app/app.ts" &&
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
  assert(cells.length > 0, `No Angular calibration cell matches ${requestedCell ?? "the matrix"}`);
  const workspace = join(scratch, "workspace");
  mkdirSync(join(workspace, "apps"), { recursive: true });
  writeFileSync(join(workspace, "pnpm-workspace.yaml"), "packages:\n  - 'apps/*'\n");
  writeFileSync(join(workspace, "package.json"), '{"name":"angular-calibration","private":true}\n');
  for (const cell of cells) writeFixture(join(workspace, "apps", cell.id), cell);
  await run("pnpm", ["install", "--ignore-scripts"], {
    cwd: workspace,
    env: { PNPM_HOME: process.env.PNPM_HOME },
  });
  const cli = installPackagedCli();
  const apiOrigin = `http://127.0.0.1:${api.address().port}`;
  for (const [index, cell] of cells.entries()) {
    await exerciseCell(cli, join(workspace, "apps", cell.id), cell, apiOrigin);
    process.stdout.write(`✓ ${index + 1}/${cells.length} ${cell.id}\n`);
  }
  assert(
    state.integrations.filter((id) => id === "errors-browser-angular").length === cells.length,
    "Angular integration activation was not reported for every cell",
  );
  process.stdout.write(
    `✓ ${cells.length} supported Angular cells passed packed detection, generation, production build, four capture surfaces, privacy, lifecycle, grouping, exact source and CLI retrieval\n`,
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
