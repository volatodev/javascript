import { spawn, execFileSync } from "node:child_process";
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
const scratch = mkdtempSync(join(tmpdir(), "volato-browser-react-matrix-"));
const projectId = "00000000-0000-4000-8000-000000000120";
const authToken = "browser-matrix-agent-token";
const ingestToken = "browser-matrix-ingest-token";
const requestedCell = process.argv.find((arg) => arg.startsWith("--cell="))?.slice(7);
const cells = runtimeMatrix.cells.filter(
  (cell) =>
    cell.family === "browser-react" &&
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
  writeFileSync(join(host, "package.json"), '{"name":"cli-host","private":true}\n');
  execFileSync(
    "npm",
    ["pack", "--pack-destination", packDir, "--cache", join(scratch, "npm")],
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
      join(scratch, "npm"),
      join(packDir, archive),
    ],
    { cwd: host, stdio: "pipe" },
  );
  return join(host, "node_modules", ".bin", "volato");
}

function sourceExtension(cell) {
  return cell.language === "ts" ? "tsx" : "jsx";
}

function packageJson(cell) {
  const devDependencies = {
    "@types/react": cell.react.startsWith("18.") ? "18.3.28" : "19.2.2",
    "@types/react-dom": cell.react.startsWith("18.") ? "18.3.7" : "19.2.2",
    typescript: runtimeMatrix.versions.typescript[0],
  };
  if (cell.adapter === "vite") {
    devDependencies.vite = cell.adapterVersion;
  } else if (cell.adapter === "webpack") {
    Object.assign(devDependencies, {
      webpack: cell.adapterVersion,
      "webpack-cli": runtimeMatrix.versions.webpackCli[0],
      "html-webpack-plugin": "5.6.6",
      "esbuild-loader": "4.4.0",
      esbuild: "0.28.2",
    });
  } else {
    Object.assign(devDependencies, {
      "@rspack/core": cell.adapterVersion,
      "@rspack/cli": cell.adapterVersion,
    });
  }
  return {
    name: cell.id,
    private: true,
    type: "module",
    scripts: {
      build:
        cell.adapter === "vite"
          ? "vite build"
          : cell.adapter === "webpack"
            ? `webpack --config ${cell.config}`
            : `rspack build --config ${cell.config}`,
    },
    dependencies: { react: cell.react, "react-dom": cell.react },
    devDependencies,
  };
}

function appSource(cell) {
  return `import React, { useEffect, useState } from "react";
import { captureBrowserError } from "./volato/browser";

export default function App() {
  const [renderFailure, setRenderFailure] = useState(false);
  useEffect(() => {
    void captureBrowserError(new Error("manual:${cell.id}"));
    window.dispatchEvent(new ErrorEvent("error", { error: new Error("window:${cell.id}") }));
    void Promise.reject(new Error("rejection:${cell.id}"));
    setTimeout(() => setRenderFailure(true), 0);
  }, []);
  if (renderFailure) throw new Error("render:${cell.id}");
  return <main>Volato browser matrix</main>;
}
`;
}

function mainSource(cell) {
  return `import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
createRoot(document.getElementById("root")${cell.language === "ts" ? "!" : ""}).render(<App />);
`;
}

function viteConfig(cell) {
  return `import { defineConfig } from "vite";
export default defineConfig({
  base: process.env.VOLATO_CONFORMANCE_BASE === "custom" ? "/nested/" : "/",
});
`;
}

function webpackConfig(cell) {
  const loader = cell.language === "ts" ? "tsx" : "jsx";
  const object = `{
  mode: "production",
  entry: "./src/main.${sourceExtension(cell)}",
  output: {
    path: path.resolve(${cell.module === "cjs" ? "__dirname" : 'dirname(fileURLToPath(import.meta.url))'}, "dist"),
    publicPath: process.env.VOLATO_CONFORMANCE_BASE === "custom" ? "/nested/" : "/",
    clean: true,
  },
  resolve: { extensions: [".tsx", ".ts", ".jsx", ".js"] },
  module: {
    rules: [{
      test: /\\.[jt]sx?$/,
      exclude: /node_modules/,
      use: { loader: "esbuild-loader", options: { loader: "${loader}", jsx: "automatic", target: "es2022" } },
    }],
  },
  plugins: [new HtmlWebpackPlugin({ template: "./index.html" })],
}`;
  if (cell.module === "cjs") {
    return `const path = require("node:path");
const HtmlWebpackPlugin = require("html-webpack-plugin");
module.exports = ${object};
`;
  }
  return `import path from "node:path";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import HtmlWebpackPlugin from "html-webpack-plugin";
export default ${object};
`;
}

function rspackConfig(cell) {
  const syntax = cell.language === "ts" ? "typescript" : "ecmascript";
  const object = `{
  mode: "production",
  entry: "./src/main.${sourceExtension(cell)}",
  output: {
    path: path.resolve(dirname(fileURLToPath(import.meta.url)), "dist"),
    publicPath: process.env.VOLATO_CONFORMANCE_BASE === "custom" ? "/nested/" : "/",
    clean: true,
  },
  resolve: { extensions: [".tsx", ".ts", ".jsx", ".js"] },
  module: {
    rules: [{
      test: /\\.[jt]sx?$/,
      exclude: /node_modules/,
      use: [{
        loader: "builtin:swc-loader",
        options: {
          jsc: {
            parser: { syntax: "${syntax}", tsx: true, jsx: true },
            transform: { react: { runtime: "automatic" } },
          },
        },
      }],
    }],
  },
  plugins: [new HtmlRspackPlugin({ template: "./index.html" })],
}`;
  const imports = `import path, { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { HtmlRspackPlugin } from "@rspack/core";
`;
  return cell.config.endsWith(".ts")
    ? `${imports}import { defineConfig } from "@rspack/cli";\nexport default defineConfig(${object});\n`
    : `${imports}export default ${object};\n`;
}

function writeFixture(root, cell) {
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(
    join(root, "package.json"),
    `${JSON.stringify(packageJson(cell), null, 2)}\n`,
  );
  writeFileSync(
    join(root, "index.html"),
    '<!doctype html><html><body><div id="root"></div><script type="module" src="/src/main.' +
      sourceExtension(cell) +
      '"></script></body></html>\n',
  );
  writeFileSync(join(root, "src", `App.${sourceExtension(cell)}`), appSource(cell));
  writeFileSync(join(root, "src", `main.${sourceExtension(cell)}`), mainSource(cell));
  const configSource =
    cell.adapter === "vite"
      ? viteConfig(cell)
      : cell.adapter === "webpack"
        ? webpackConfig(cell)
        : rspackConfig(cell);
  writeFileSync(join(root, cell.config), configSource);
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
        },
        include: ["src", cell.config],
      },
      null,
      2,
    )}\n`,
  );
  writeFileSync(join(root, ".gitignore"), "node_modules\ndist\n.env*.local\n");
}

const state = { events: [], maps: [], integrations: [] };

function multipartField(body, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(
    `name="${escaped}"(?:; filename="[^"]+")?\\r\\n(?:Content-Type:[^\\r]+\\r\\n)?\\r\\n([\\s\\S]*?)\\r\\n--`,
  ).exec(body)?.[1];
}

const api = createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "POST, OPTIONS",
      "access-control-allow-headers": "Content-Type, X-Volato-DSN",
    });
    res.end();
    return;
  }
  if (req.method === "GET" && /^\/v1\/projects\/[0-9a-f-]+\/setup$/.test(url.pathname)) {
    const address = api.address();
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        data: {
          projectId,
          projectName: "Browser matrix",
          dsn: `http://public@127.0.0.1:${address.port}/${projectId}`,
          ingestToken,
        },
      }),
    );
    return;
  }
  if (req.method === "POST" && /^\/v1\/projects\/[0-9a-f-]+\/linked$/.test(url.pathname)) {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ data: { linked: true } }));
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
      const text = body.toString("utf8");
      state.maps.push({
        release: multipartField(text, "release"),
        filenameHash: multipartField(text, "filename_hash"),
        displayPath: multipartField(text, "display_path"),
        map: multipartField(text, "map"),
        raw: text,
      });
      res.writeHead(201, { "content-type": "application/json" });
      res.end(JSON.stringify({ stored: true }));
    });
    return;
  }
  res.writeHead(404).end();
});

function allFiles(root) {
  if (!existsSync(root)) return [];
  return readdirSync(root).flatMap((name) => {
    const path = join(root, name);
    return statSync(path).isDirectory() ? allFiles(path) : [path];
  });
}

const contentTypes = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
};

function serveDist(root, base) {
  const server = createServer((req, res) => {
    let pathname = new URL(req.url ?? "/", "http://127.0.0.1").pathname;
    if (base !== "/" && pathname.startsWith(base)) pathname = pathname.slice(base.length - 1);
    const relative = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
    const path = join(root, relative);
    if (!path.startsWith(root) || !existsSync(path) || statSync(path).isDirectory()) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, {
      "content-type": contentTypes[extname(path)] ?? "application/octet-stream",
    });
    res.end(readFileSync(path));
  });
  return new Promise((resolveServer, rejectServer) => {
    server.once("error", rejectServer);
    server.listen(0, "127.0.0.1", () => resolveServer(server));
  });
}

function assertResolvedSource(cell, release, events) {
  const maps = state.maps.filter((map) => map.release === release);
  assert(maps.length > 0, `${cell.id} uploaded no map for ${release}`);
  assert(
    maps.every((record) => record.map && !record.raw.includes("sourcesContent")),
    `${cell.id} uploaded source content`,
  );
  const event = events.find((candidate) => candidate.message === `manual:${cell.id}`);
  const frame = /https?:\/\/[^\s)]+?-([a-zA-Z0-9_-]{8,20})\.js:(\d+):(\d+)/.exec(
    event?.stack ?? "",
  );
  assert(frame, `${cell.id} manual event has no addressable production frame: ${event?.stack}`);
  const record = maps.find((candidate) => candidate.filenameHash === frame[1]);
  assert(record?.map, `${cell.id} uploaded no map for runtime hash ${frame[1]}`);
  const original = originalPositionFor(new TraceMap(JSON.parse(record.map)), {
    line: Number(frame[2]),
    column: Number(frame[3]),
  });
  assert(
    original.source?.endsWith(`src/App.${sourceExtension(cell)}`) &&
      typeof original.line === "number",
    `${cell.id} resolved to ${JSON.stringify(original)} instead of App source`,
  );
}

async function exerciseBuild(cell, root, scenario, apiOrigin) {
  const release = `${cell.id}-${scenario}`;
  const base = scenario === "custom" ? "/nested/" : "/";
  const beforeMaps = state.maps.length;
  await run("pnpm", ["build"], {
    cwd: root,
    env: {
      VITE_VOLATO_DSN: `${apiOrigin.replace("http://", "http://public@")}\/${projectId}`,
      VOLATO_DSN: `${apiOrigin.replace("http://", "http://public@")}\/${projectId}`,
      VOLATO_INGEST_TOKEN: ingestToken,
      VOLATO_RELEASE: release,
      VOLATO_CONFORMANCE_BASE: scenario,
    },
  });
  assert(state.maps.length > beforeMaps, `${cell.id} ${scenario} uploaded no map`);
  assert(
    allFiles(join(root, "dist")).every((path) => !path.endsWith(".map")),
    `${cell.id} ${scenario} left a public browser map`,
  );
  const server = await serveDist(join(root, "dist"), base);
  const address = server.address();
  const beforeEvents = state.events.length;
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${address.port}${base}`, {
      waitUntil: "networkidle",
    });
    await page.waitForFunction(
      ([id, count]) =>
        fetch("/matrix-observation", { method: "POST" }).catch(() => undefined) ||
        document.body.textContent?.includes(id) || count === 4,
      [cell.id, 4],
      { timeout: 100 },
    ).catch(() => undefined);
    const deadline = Date.now() + 10_000;
    while (
      state.events
        .slice(beforeEvents)
        .filter((event) => String(event.message).endsWith(cell.id)).length < 4 &&
      Date.now() < deadline
    ) {
      await new Promise((resolveWait) => setTimeout(resolveWait, 50));
    }
  } finally {
    await browser.close();
    await new Promise((resolveClose) => server.close(resolveClose));
  }
  const events = state.events
    .slice(beforeEvents)
    .filter((event) => String(event.message).endsWith(cell.id));
  assert(events.length === 4, `${cell.id} ${scenario} emitted ${events.length}/4 events`);
  assert(
    events.every(
      (event) =>
        event.runtime === "browser" &&
        !JSON.stringify(event).includes("private@example.com") &&
        !String(event.route ?? "").includes("nested"),
    ),
    `${cell.id} ${scenario} emitted unsafe browser context`,
  );
  assertResolvedSource(cell, release, events);
}

api.listen(0, "127.0.0.1");
await new Promise((resolveListen, rejectListen) => {
  api.once("listening", resolveListen);
  api.once("error", rejectListen);
});

try {
  assert(cells.length > 0, `No browser matrix cell matches ${requestedCell ?? "the matrix"}`);
  const workspace = join(scratch, "workspace");
  mkdirSync(workspace, { recursive: true });
  writeFileSync(join(workspace, "pnpm-workspace.yaml"), "packages:\n  - 'apps/*'\n");
  writeFileSync(
    join(workspace, "package.json"),
    '{"name":"browser-matrix","private":true}\n',
  );
  for (const cell of cells) writeFixture(join(workspace, "apps", cell.id), cell);
  await run("pnpm", ["install", "--ignore-scripts"], { cwd: workspace });
  const cli = installPackagedCli();
  const address = api.address();
  const apiOrigin = `http://127.0.0.1:${address.port}`;
  for (const [index, cell] of cells.entries()) {
    const root = join(workspace, "apps", cell.id);
    await run(cli, ["init", "--project", projectId, "--yes"], {
      cwd: root,
      env: { VOLATO_API_URL: apiOrigin, VOLATO_TOKEN: authToken },
    });
    await run(cli, ["errors", "init", "--yes"], {
      cwd: root,
      env: { VOLATO_API_URL: apiOrigin, VOLATO_TOKEN: authToken },
    });
    for (const scenario of ["default", "custom"]) {
      await exerciseBuild(cell, root, scenario, apiOrigin);
    }
    process.stdout.write(`✓ ${index + 1}/${cells.length} ${cell.id}\n`);
  }
  process.stdout.write(
    `✓ ${cells.length} browser cells passed default/custom builds, four capture surfaces, privacy, private maps, and source resolution\n`,
  );
} finally {
  await new Promise((resolveClose) => api.close(resolveClose));
  rmSync(scratch, { recursive: true, force: true });
}
