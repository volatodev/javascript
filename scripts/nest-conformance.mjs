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
import { originalPositionFor, TraceMap } from "@jridgewell/trace-mapping";
import { runtimeMatrix } from "./errors-runtime-matrix.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const scratch = mkdtempSync(join(tmpdir(), "volato-nest-conformance-"));
const projectId = "00000000-0000-4000-8000-0000000001e5";
const authToken = "nest-conformance-auth";
const ingestToken = "nest-conformance-ingest";
const cells = runtimeMatrix.cells.filter((cell) => cell.family === "nest-http");
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
    }, options.timeoutMs ?? 120_000);
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
  const pack = join(scratch, "pack");
  mkdirSync(host, { recursive: true });
  mkdirSync(pack, { recursive: true });
  writeFileSync(join(host, "package.json"), '{"name":"nest-cli-host","private":true}\n');
  execFileSync(
    "npm",
    ["pack", "--pack-destination", pack, "--cache", join(scratch, "npm")],
    { cwd: join(repositoryRoot, "packages", "cli"), stdio: "pipe" },
  );
  const archive = readdirSync(pack).find((name) => name.endsWith(".tgz"));
  assert(archive, "npm pack produced no CLI archive");
  execFileSync(
    "npm",
    [
      "install",
      "--no-audit",
      "--no-fund",
      "--cache",
      join(scratch, "npm"),
      join(pack, archive),
    ],
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
  assert(
    execFileSync(binary, ["--version"], { encoding: "utf8" }).trim() ===
      `v${version}`,
    `Nest conformance did not install Node ${version}`,
  );
  return binary;
}

function packageJson(cell) {
  const dependencies = {
    "@nestjs/common": cell.nest,
    "@nestjs/core": cell.nest,
    "reflect-metadata": "0.2.2",
    rxjs: "7.8.2",
  };
  if (cell.transport === "fastify") {
    dependencies["@nestjs/platform-fastify"] = cell.nest;
    dependencies.fastify = cell.transportVersion;
  } else {
    dependencies["@nestjs/platform-express"] = cell.nest;
    dependencies.express = cell.transportVersion;
  }
  return {
    name: cell.id,
    private: true,
    type: "commonjs",
    scripts: { build: "nest build" },
    dependencies,
    devDependencies: {
      "@nestjs/cli": cell.nestCli,
      "@types/node": "24.12.2",
      typescript: runtimeMatrix.versions.typescript[0],
    },
  };
}

function mainSource(cell) {
  const fastifyImport =
    cell.transport === "fastify"
      ? 'import { FastifyAdapter } from "@nestjs/platform-fastify";\n'
      : "";
  const adapter =
    cell.transport === "fastify"
      ? ', new FastifyAdapter({ requestIdHeader: "x-request-id" })'
      : "";
  const expressRequestId =
    cell.transport === "express"
      ? `  app.use((request: any, _response: any, next: () => void) => {
    request.id = request.get("x-request-id");
    next();
  });
`
      : "";
  return `import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
${fastifyImport}import { AppModule } from "./app.module";

async function bootstrap() {
  const app = await NestFactory.create(AppModule${adapter});
${expressRequestId}  await app.listen(0, "127.0.0.1");
  const address = app.getHttpServer().address();
  if (address && typeof address === "object") console.log("READY:" + address.port);
  process.on("SIGTERM", () => { void app.close(); });
}
void bootstrap();
`;
}

function controllerSource(cell) {
  return `import {
  CanActivate,
  Controller,
  ExecutionContext,
  Get,
  Injectable,
  NestInterceptor,
  Param,
  PipeTransform,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";

@Injectable()
export class FailureGuard implements CanActivate {
  canActivate(_context: ExecutionContext): boolean {
    throw new Error("guard ${cell.id}");
  }
}

@Injectable()
export class FailurePipe implements PipeTransform {
  transform(_value: unknown): never {
    throw new Error("pipe ${cell.id}");
  }
}

@Injectable()
export class FailureInterceptor implements NestInterceptor {
  intercept(): never {
    throw new Error("interceptor ${cell.id}");
  }
}

@Controller("api")
export class AppController {
  @Get("controller/:id")
  controller(): never {
    throw new Error("controller ${cell.id}");
  }

  @Get("guard/:id")
  @UseGuards(FailureGuard)
  guard(): string {
    return "unreachable";
  }

  @Get("pipe/:id")
  pipe(@Param("id", FailurePipe) _id: string): string {
    return "unreachable";
  }

  @Get("interceptor/:id")
  @UseInterceptors(FailureInterceptor)
  interceptor(): string {
    return "unreachable";
  }

  @Get("health")
  health(): { ok: true } {
    return { ok: true };
  }
}
`;
}

function writeFixture(root, cell) {
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(
    join(root, "package.json"),
    `${JSON.stringify(packageJson(cell), null, 2)}\n`,
  );
  writeFileSync(join(root, "src", "main.ts"), mainSource(cell));
  writeFileSync(join(root, "src", "app.controller.ts"), controllerSource(cell));
  writeFileSync(
    join(root, "src", "app.module.ts"),
    `import { Module } from "@nestjs/common";
import {
  AppController,
  FailureGuard,
  FailureInterceptor,
  FailurePipe,
} from "./app.controller";

@Module({
  controllers: [AppController],
  providers: [FailureGuard, FailurePipe, FailureInterceptor],
})
export class AppModule {}
`,
  );
  writeFileSync(
    join(root, "tsconfig.json"),
    `${JSON.stringify(
      {
        compilerOptions: {
          module: "commonjs",
          target: "ES2022",
          moduleResolution: "node",
          rootDir: "src",
          outDir: "dist",
          sourceMap: true,
          inlineSources: false,
          experimentalDecorators: true,
          emitDecoratorMetadata: true,
          esModuleInterop: true,
          skipLibCheck: true,
          strict: true,
        },
        include: ["src"],
      },
      null,
      2,
    )}\n`,
  );
  writeFileSync(
    join(root, "tsconfig.build.json"),
    '{"extends":"./tsconfig.json","exclude":["node_modules","dist"]}\n',
  );
  writeFileSync(
    join(root, "nest-cli.json"),
    '{"collection":"@nestjs/schematics","sourceRoot":"src"}\n',
  );
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
      () => rejectReady(new Error(`Nest server did not start:\n${output}`)),
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
    child.once("error", (error) => {
      clearTimeout(timeout);
      rejectReady(error);
    });
    child.once("close", (status) => {
      clearTimeout(timeout);
      rejectReady(new Error(`Nest server exited ${status}:\n${output}`));
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

function assertSourceResolution(cell, fixture, event, surface) {
  const sourceRelative = "src/app.controller.ts";
  const source = readFileSync(join(fixture, sourceRelative), "utf8");
  const expectedLine =
    source
      .split("\n")
      .findIndex((line) => line.includes(`new Error("${surface} ${cell.id}")`)) +
    1;
  assert(expectedLine > 0, `${cell.id} has no ${surface} causal line`);
  const output = join(fixture, "dist", "app.controller.js");
  const frame = new RegExp(`${escapeRegExp(output)}:(\\d+):(\\d+)`).exec(
    event.stack ?? "",
  );
  assert(frame, `${cell.id} ${surface} stack missed ${output}: ${event.stack}`);
  const map = JSON.parse(readFileSync(`${output}.map`, "utf8"));
  assert(!("sourcesContent" in map), `${cell.id} retained sourcesContent`);
  const original = originalPositionFor(new TraceMap(map), {
    line: Number(frame[1]),
    column: Number(frame[2]) - 1,
  });
  assert(
    original.source?.replaceAll("\\", "/").endsWith(sourceRelative) &&
      original.line === expectedLine,
    `${cell.id} ${surface} resolved to ${original.source}:${original.line}, expected ${sourceRelative}:${expectedLine}`,
  );
}

const state = { events: [], maps: [], integrations: [] };
const api = createServer((request, response) => {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  if (
    request.method === "GET" &&
    /^\/v1\/projects\/[0-9a-f-]+\/setup$/.test(url.pathname)
  ) {
    const address = api.address();
    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        data: {
          projectId,
          projectName: "Nest matrix",
          dsn: `http://public@127.0.0.1:${address.port}/${projectId}`,
          ingestToken,
        },
      }),
    );
    return;
  }
  if (
    request.method === "POST" &&
    /^\/v1\/projects\/[0-9a-f-]+\/linked$/.test(url.pathname)
  ) {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ data: { linked: true } }));
    return;
  }
  const integration = url.pathname.match(
    /^\/v1\/projects\/[0-9a-f-]+\/integrations\/(errors-[a-z-]+)$/,
  );
  if (request.method === "POST" && integration) {
    state.integrations.push(integration[1]);
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
      response.writeHead(202, { "content-type": "application/json" });
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

async function assertSurface(cell, fixture, port, surface) {
  const before = state.events.length;
  const requestId = `request-safe-${cell.id}`;
  const response = await fetch(
    `http://127.0.0.1:${port}/api/${surface}/private-user?token=query-secret`,
    {
      headers: {
        authorization: "header-secret",
        cookie: "session=cookie-secret",
        "x-request-id": requestId,
        "x-arbitrary": "arbitrary-secret",
      },
    },
  );
  const body = await response.json();
  assert(
    response.status === 500 &&
      body.statusCode === 500 &&
      body.message === "Internal server error",
    `${cell.id} ${surface} did not delegate to the default Nest filter: ${response.status} ${JSON.stringify(body)}`,
  );
  const events = state.events.slice(before);
  assert(
    events.length === 1,
    `${cell.id} ${surface} emitted ${events.length} events instead of one`,
  );
  const event = events[0];
  assert(
    event.runtime === "node" &&
      event.capturedVia === "nest_exception_filter" &&
      event.method === "GET" &&
      event.route === `/api/${surface}/:id` &&
      event.status === 500 &&
      event.requestId === requestId,
    `${cell.id} ${surface} context failed: ${JSON.stringify(event)}`,
  );
  assert(
    !JSON.stringify(event).match(
      /private-user|query-secret|header-secret|cookie-secret|arbitrary-secret/,
    ),
    `${cell.id} ${surface} leaked request data`,
  );
  assertSourceResolution(cell, fixture, event, surface);
}

async function conformCell(cell, context) {
  const fixture = join(scratch, "fixtures", cell.id);
  writeFixture(fixture, cell);
  await run(
    "npm",
    ["install", "--no-audit", "--no-fund", "--cache", join(scratch, "npm")],
    { cwd: fixture },
  );
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
        .includes("errors-node-nestjs"),
    `${cell.id} setup was incomplete:\n${setup.stdout}\n${setup.stderr}`,
  );
  const main = readFileSync(join(fixture, "src", "main.ts"), "utf8");
  assert(
    main.includes("VolatoHttpExceptionFilter") &&
      !main.includes("volatoFastifyErrorHook") &&
      !main.includes("volatoExpressErrorHandler"),
    `${cell.id} did not leave Nest as the sole HTTP capture owner`,
  );
  assert(
    !readFileSync(join(fixture, "package.json"), "utf8").includes("@volatodev"),
    `${cell.id} gained a Volato runtime dependency`,
  );

  const mapsBefore = state.maps.length;
  await run("npm", ["run", "build"], {
    cwd: fixture,
    env: {
      VOLATO_DSN: context.dsn,
      VOLATO_INGEST_TOKEN: ingestToken,
      VOLATO_RELEASE: `conformance-${cell.id}`,
    },
  });
  const maps = state.maps.slice(mapsBefore);
  assert(maps.length >= 3, `${cell.id} uploaded no private maps`);
  assert(
    maps.every((body) => !body.includes("sourcesContent")) &&
      allFiles(join(fixture, "dist"))
        .filter((path) => path.endsWith(".map"))
        .every((path) => !readFileSync(path, "utf8").includes("sourcesContent")),
    `${cell.id} exposed sourcesContent`,
  );

  const child = spawn(context.node, [join(fixture, "dist", "main.js")], {
    cwd: fixture,
    env: {
      ...process.env,
      VOLATO_DSN: context.dsn,
      VOLATO_RELEASE: `conformance-${cell.id}`,
      NODE_ENV: "production",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  runningChildren.add(child);
  try {
    const port = await waitForServer(child);
    for (const surface of ["controller", "guard", "pipe", "interceptor"]) {
      await assertSurface(cell, fixture, port, surface);
    }
    const health = await fetch(`http://127.0.0.1:${port}/api/health`);
    assert(health.status === 200, `${cell.id} did not survive handled failures`);
  } finally {
    await stopServer(child);
    runningChildren.delete(child);
  }
  process.stdout.write(`✓ ${cell.id}\n`);
}

try {
  assert(cells.length === 8, `expected 8 Nest cells, got ${cells.length}`);
  await new Promise((resolveListen, rejectListen) => {
    api.once("error", rejectListen);
    api.listen(0, "127.0.0.1", resolveListen);
  });
  const address = api.address();
  assert(address && typeof address === "object", "mock API did not bind");
  const apiOrigin = `http://127.0.0.1:${address.port}`;
  const dsn = `http://public@127.0.0.1:${address.port}/${projectId}`;
  const cli = installPackagedCli();
  const nodes = new Map(
    [...new Set(cells.map((cell) => cell.node))].map((version) => [
      version,
      installExactNode(version),
    ]),
  );
  for (const cell of cells) {
    await conformCell(cell, {
      apiOrigin,
      dsn,
      cli,
      node: nodes.get(cell.node),
    });
  }
  process.stdout.write(
    `✓ ${cells.length} Nest cells passed delegated responses, four HTTP origins, deduplication, privacy, maps, and exact source resolution\n`,
  );
} finally {
  for (const child of runningChildren) child.kill("SIGKILL");
  await new Promise((resolveClose) => api.close(resolveClose));
  rmSync(scratch, { recursive: true, force: true });
}
