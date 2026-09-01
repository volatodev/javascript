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
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runtimeMatrix } from "./errors-runtime-matrix.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const scratch = mkdtempSync(join(tmpdir(), "volato-fastapi-calibration-"));
const projectId = "00000000-0000-4000-8000-000000000230";
const groupId = "00000000-0000-4000-8000-000000000231";
const authToken = "fastapi-calibration-workspace-token";
const requestedCell = process.argv.find((arg) => arg.startsWith("--cell="))?.slice(7);
const cells = runtimeMatrix.cells.filter(
  (cell) =>
    cell.family === "python-fastapi" &&
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
  writeFileSync(
    join(host, "package.json"),
    '{"name":"fastapi-cli-host","private":true}\n',
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

function writeFixture(root, cell, appSource) {
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, ".python-version"), `${cell.python}\n`);
  writeFileSync(
    join(root, "pyproject.toml"),
    `[project]\nname = "${cell.id}"\nrequires-python = "==${cell.python}.*"\ndependencies = [\n  "fastapi==${cell.frameworkVersion}",\n  "starlette==${cell.adapterVersion}",\n  "uvicorn==${cell.serverVersion}",\n  "pydantic==${runtimeMatrix.versions.pydantic[0]}",\n  "anyio==${runtimeMatrix.versions.anyio[0]}",\n]\n`,
  );
  writeFileSync(join(root, "app.py"), appSource ?? applicationSource(cell));
  writeFileSync(
    join(root, ".gitignore"),
    ".env*.local\n.venv/\n.pip-cache/\n__pycache__/\n",
  );
  writeFileSync(
    join(root, "probe.py"),
    readFileSync(join(repositoryRoot, "scripts", "fastapi-runtime-probe.py"), "utf8"),
  );
}

function applicationSource(cell) {
  return `from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse, PlainTextResponse

app = FastAPI()
handled_ids = []
route_failure = RuntimeError("route unavailable")

@app.exception_handler(Exception)
async def application_error_handler(request: Request, error: Exception):
    handled_ids.append(id(error))
    return PlainTextResponse("application-owned", status_code=500)

@app.middleware("http")
async def application_middleware(request: Request, call_next):
    if request.headers.get("x-trigger-failure") == "yes":
        raise RuntimeError("middleware unavailable")
    return await call_next(request)

async def failing_dependency():
    raise RuntimeError("dependency unavailable")

@app.post("/boom/{order_id}")
async def boom(order_id: str):
    raise route_failure

@app.get("/dependency/{item_id}")
async def dependency_failure(item_id: str, value = Depends(failing_dependency)):
    return {"value": value}

@app.get("/expected")
async def expected():
    raise HTTPException(status_code=418, detail="expected")

@app.get("/validated/{item_id}")
async def validated(item_id: int):
    return {"item_id": item_id}

@app.get("/explicit")
async def explicit():
    return JSONResponse({"expected": True}, status_code=409)

@app.get("/alpha/{value}")
async def alpha(value: str):
    raise RuntimeError("alpha unavailable")

@app.get("/beta/{value}")
async def beta(value: str):
    raise RuntimeError("beta unavailable")

@app.get("/health")
async def health():
    return {"ok": True, "cell": "${cell.id}"}
`;
}

function snapshot(root) {
  const entries = {};
  const visit = (directory) => {
    for (const name of readdirSync(directory).sort()) {
      const path = join(directory, name);
      if (statSync(path).isDirectory()) visit(path);
      else {
        entries[relative(root, path).replaceAll("\\", "/")] = readFileSync(path).toString(
          "base64",
        );
      }
    }
  };
  visit(root);
  return entries;
}

const state = {
  events: [],
  integrations: [],
  context: null,
};

function json(response, data, status = 200, markdown = "") {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(
    JSON.stringify(status >= 200 && status < 300 ? { markdown, data } : { error: data }),
  );
}

const api = createServer((request, response) => {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  if (request.method === "GET" && /^\/v1\/projects\/[0-9a-f-]+\/setup$/.test(url.pathname)) {
    const address = api.address();
    json(response, {
      projectId,
      projectName: "FastAPI calibration",
      dsn: `http://public@127.0.0.1:${address.port}/${projectId}`,
      ingestToken: "unused-python-token",
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
      state.events.push(JSON.parse(body));
      json(response, { accepted: true }, 202);
    });
    return;
  }
  if (request.method === "GET" && url.pathname === "/v1/errors/context") {
    if (!state.context) {
      json(response, "not_found", 404);
      return;
    }
    json(
      response,
      state.context,
      200,
      `# ${state.context.group.message}\n\n**Status:** unresolved\n**Source:** ${state.context.resolvedFrame.original_path}:${state.context.resolvedFrame.original_line}:1\n`,
    );
    return;
  }
  json(response, "not_found", 404);
});

function dockerProbeArgs(root, cell, dsn) {
  const installAndProbe = [
    "import subprocess, sys",
    `deps = ${JSON.stringify([
      `fastapi==${cell.frameworkVersion}`,
      `starlette==${cell.adapterVersion}`,
      `uvicorn==${cell.serverVersion}`,
      `pydantic==${runtimeMatrix.versions.pydantic[0]}`,
      `anyio==${runtimeMatrix.versions.anyio[0]}`,
      "httpx==0.28.1",
    ])}`,
    "subprocess.check_call([sys.executable, '-m', 'venv', '.venv'])",
    "python = '.venv/bin/python'",
    "subprocess.check_call([python, '-m', 'pip', 'install', '--quiet', *deps])",
    "subprocess.check_call([python, '-m', 'compileall', '-q', 'app.py', 'volato_errors'])",
    "subprocess.check_call([python, 'probe.py'])",
  ].join("; ");
  return [
    "run",
    "--rm",
    "--add-host=host.docker.internal:host-gateway",
    "--user",
    `${process.getuid()}:${process.getgid()}`,
    "-v",
    `${root}:/app`,
    "-w",
    "/app",
    "-e",
    `VOLATO_DSN=${dsn}`,
    "-e",
    `VOLATO_RELEASE=${"a".repeat(40)}`,
    "-e",
    "VOLATO_ENVIRONMENT=production",
    "-e",
    "PIP_DISABLE_PIP_VERSION_CHECK=1",
    "-e",
    "HOME=/tmp",
    "-e",
    "PIP_CACHE_DIR=/app/.pip-cache",
    `python:${cell.python}-slim`,
    "python",
    "-c",
    installAndProbe,
  ];
}

async function exerciseCell(cli, root, cell, apiOrigin, dockerOrigin) {
  const beforeEvents = state.events.length;
  await run(cli, ["init", "--project", projectId, "--yes"], {
    cwd: root,
    env: { VOLATO_API_URL: apiOrigin, VOLATO_TOKEN: authToken },
  });
  await run(cli, ["errors", "init", "--yes"], {
    cwd: root,
    env: { VOLATO_API_URL: apiOrigin, VOLATO_TOKEN: authToken },
  });
  const afterFirst = snapshot(root);
  await run(cli, ["errors", "init", "--yes"], {
    cwd: root,
    env: { VOLATO_API_URL: apiOrigin, VOLATO_TOKEN: authToken },
  });
  assert(
    JSON.stringify(snapshot(root)) === JSON.stringify(afterFirst),
    `${cell.id} did not converge on rerun`,
  );
  assert(
    existsSync(join(root, ".agents", "skills", "volato-fastapi", "SKILL.md")),
    `${cell.id} packed CLI did not install the FastAPI skill`,
  );

  const dsn = `http://public@host.docker.internal:${api.address().port}/${projectId}`;
  const probe = await run("docker", dockerProbeArgs(root, cell, dsn), { cwd: root });
  assert(probe.stdout.includes('"ok": true'), `${cell.id} runtime probe did not finish`);

  const events = state.events.slice(beforeEvents);
  assert(events.length === 6, `${cell.id} emitted ${events.length}/6 events`);
  const byMessage = new Map(events.map((event) => [event.message, event]));
  assert(byMessage.get("manual unavailable")?.capturedVia === "manual", `${cell.id} lost manual capture`);
  for (const message of [
    "route unavailable",
    "dependency unavailable",
    "middleware unavailable",
    "alpha unavailable",
    "beta unavailable",
  ]) {
    const event = byMessage.get(message);
    assert(
      event?.runtime === "python" && event?.capturedVia === "asgi_http",
      `${cell.id} lost ASGI identity for ${message}`,
    );
  }
  const route = byMessage.get("route unavailable");
  assert(route?.route === "/boom/{order_id}", `${cell.id} lost matched route template`);
  assert(route?.requestId === "route-request", `${cell.id} lost bounded request ID`);
  assert(
    byMessage.get("alpha unavailable")?.route === "/alpha/{value}" &&
      byMessage.get("alpha unavailable")?.requestId === "alpha-request" &&
      byMessage.get("beta unavailable")?.route === "/beta/{value}" &&
      byMessage.get("beta unavailable")?.requestId === "beta-request",
    `${cell.id} mixed concurrent request context`,
  );
  const serialized = JSON.stringify(events);
  for (const secret of [
    "private-order",
    "query-secret",
    "authorization-secret",
    "cookie-secret",
    "header-secret",
    "body-secret@example.com",
    "private-value",
    "private-alpha",
    "private-beta",
  ]) {
    assert(!serialized.includes(secret), `${cell.id} leaked ${secret}`);
  }
  assert(!serialized.includes("HTTPException") && !serialized.includes("validation"), `${cell.id} captured handled outcomes`);
  const source = /^\s*raise route_failure\s*$/m.exec(readFileSync(join(root, "app.py"), "utf8"));
  const line = readFileSync(join(root, "app.py"), "utf8")
    .slice(0, source.index)
    .split("\n").length;
  assert(
    String(route.stack).includes(`File "app.py", line ${line}, in boom`) &&
      !String(route.stack).includes("raise route_failure"),
    `${cell.id} lost exact source or serialized source text`,
  );

  state.context = {
    group: {
      id: groupId,
      projectId,
      projectName: "FastAPI calibration",
      fingerprint: `fastapi:${cell.id}`,
      message: route.message,
      severity: "error",
      status: "unresolved",
      eventCount: 1,
      matchingEventCount: 1,
      affectedUserCount: 0,
      firstSeen: "2026-08-28T10:00:00.000Z",
      lastSeen: "2026-08-28T10:00:00.000Z",
      firstMatchedAt: "2026-08-28T10:00:00.000Z",
      lastMatchedAt: "2026-08-28T10:00:00.000Z",
      runtimes: ["python"],
      routes: [route.route],
      releases: [route.release],
      baselineEventCount: 0,
      growthDelta: 1,
      growthRatio: null,
    },
    events: [route],
    commitTransition: null,
    resolvedFrame: {
      original_path: "app.py",
      original_line: line,
      original_column: 1,
    },
    resolutionState: "direct",
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
    parsed.data?.resolvedFrame?.original_path === "app.py" &&
      parsed.data?.resolvedFrame?.original_line === line &&
      parsed.data?.group?.status === "unresolved",
    `${cell.id} CLI context lost exact Python source or honest recovery state`,
  );
}

async function proveByteIdenticalRefusal(cli, root, apiOrigin) {
  const cell = cells[0];
  writeFixture(
    root,
    cell,
    "from fastapi import FastAPI\ndef create_app():\n    return FastAPI()\n",
  );
  await run(cli, ["init", "--project", projectId, "--yes"], {
    cwd: root,
    env: { VOLATO_API_URL: apiOrigin, VOLATO_TOKEN: authToken },
  });
  const before = snapshot(root);
  const refused = await run(cli, ["errors", "init", "--yes"], {
    cwd: root,
    env: { VOLATO_API_URL: apiOrigin, VOLATO_TOKEN: authToken },
    allowFailure: true,
  });
  assert(refused.status !== 0, "FastAPI app factory was not refused");
  assert(
    JSON.stringify(snapshot(root)) === JSON.stringify(before),
    "FastAPI refusal changed repository bytes",
  );
}

await new Promise((resolveListen, rejectListen) => {
  api.once("error", rejectListen);
  api.listen(0, "0.0.0.0", resolveListen);
});

let keepScratch = process.env.VOLATO_KEEP_CALIBRATION === "1";
try {
  assert(cells.length > 0, `No FastAPI calibration cell matches ${requestedCell ?? "the matrix"}`);
  const cli = installPackagedCli();
  const apiOrigin = `http://127.0.0.1:${api.address().port}`;
  for (const [index, cell] of cells.entries()) {
    const root = join(scratch, "apps", cell.id);
    writeFixture(root, cell);
    await exerciseCell(cli, root, cell, apiOrigin);
    process.stdout.write(`✓ ${index + 1}/${cells.length} ${cell.id}\n`);
  }
  await proveByteIdenticalRefusal(cli, join(scratch, "refused-factory"), apiOrigin);
  assert(
    state.integrations.filter((id) => id === "errors-python-fastapi").length === cells.length * 2,
    "FastAPI activation was not reported on both convergent runs for every cell",
  );
  process.stdout.write(
    `✓ ${cells.length} supported FastAPI cells passed packed detection, convergence, real framework capture, expected-error silence, propagation, concurrency, privacy, exact source and CLI retrieval\n`,
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
