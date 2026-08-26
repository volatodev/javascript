import { execFileSync, spawn } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const scratch = mkdtempSync(join(tmpdir(), "volato-nextjs-conformance-"));

/**
 * Which CLI the conformance run exercises.
 *
 * By default the workspace build, which is fast and right for iteration.
 * `VOLATO_CLI_SPEC` instead installs an immutable artifact into a scratch
 * directory and runs its published bin — `pack` for the local candidate
 * tarball, or an npm spec such as `@volatodev/cli@beta` for what users
 * actually download. A release is proven from the artifact, not the build.
 */
const cliSpec = process.env.VOLATO_CLI_SPEC;

function installPackagedCli() {
  const home = join(scratch, "cli-install");
  mkdirSync(home, { recursive: true });
  writeFileSync(
    join(home, "package.json"),
    `${JSON.stringify({ name: "volato-cli-host", private: true }, null, 2)}\n`,
  );

  let spec = cliSpec;
  if (spec === "pack") {
    const packDir = join(scratch, "cli-pack");
    mkdirSync(packDir, { recursive: true });
    execFileSync(
      "npm",
      ["pack", "--pack-destination", packDir, "--cache", join(scratch, "npm")],
      { cwd: join(repositoryRoot, "packages", "cli"), stdio: "pipe" },
    );
    const archive = readdirSync(packDir).find((name) => name.endsWith(".tgz"));
    assert(archive, "npm pack returned no archive");
    spec = join(packDir, archive);
  }

  execFileSync(
    "npm",
    [
      "install",
      "--no-audit",
      "--no-fund",
      "--cache",
      join(scratch, "npm"),
      spec,
    ],
    { cwd: home, stdio: "pipe" },
  );

  const binary = join(home, "node_modules", ".bin", "volato");
  assert(existsSync(binary), `installed CLI exposes no volato bin (${spec})`);
  return { command: binary, args: [], label: spec };
}

function resolveCli() {
  if (cliSpec) return installPackagedCli();
  const built = join(repositoryRoot, "packages", "cli", "dist", "cli.cjs");
  assert(existsSync(built), "CLI is not built; run the smoke through pnpm.");
  return {
    command: process.execPath,
    args: [built],
    label: "workspace build",
  };
}

let cliRunner;

function runCli(args, options) {
  return run(cliRunner.command, [...cliRunner.args, ...args], options);
}
const AUTH_TOKEN = "conformance-agent-token";
const INGEST_TOKEN = "conformance-ingest-token";
const FULL_MATRIX = [
  { next: "15.5.22", react: "19.2.8" },
  { next: "16.2.12", react: "19.2.8" },
].flatMap((version) =>
  ["app", "pages", "hybrid"].flatMap((router) =>
    ["ts", "js"].map((language) => ({
      ...version,
      router,
      language,
      label: `Next.js ${version.next.split(".")[0]} ${
        router === "app"
          ? "App Router"
          : router === "pages"
            ? "Pages Router"
            : "App + Pages Router"
      } ${language === "ts" ? "TypeScript" : "JavaScript"}`,
    })),
  ),
);
const requestedNextVersion = process.env.VOLATO_NEXTJS_VERSION;
const requestedLanguage = process.env.VOLATO_NEXTJS_LANGUAGE;
const requestedRouter = process.env.VOLATO_NEXTJS_ROUTER;
const MATRIX = FULL_MATRIX.filter(
  (entry) =>
    (!requestedNextVersion || entry.next === requestedNextVersion) &&
    (!requestedLanguage || entry.language === requestedLanguage) &&
    (!requestedRouter || entry.router === requestedRouter),
);

if (MATRIX.length === 0) {
  throw new Error(
    `Unsupported Next.js conformance selection: version=${
      requestedNextVersion ?? "all"
    }, language=${requestedLanguage ?? "all"}, router=${
      requestedRouter ?? "all"
    }`,
  );
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function filesWithSuffix(root, suffix) {
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name);
    if (entry.isDirectory()) return filesWithSuffix(path, suffix);
    return path.endsWith(suffix) ? [path] : [];
  });
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
    child.on("error", rejectRun);
    child.on("close", (status) => {
      if (status !== 0 && !options.allowFailure) {
        rejectRun(
          new Error(
            `${command} ${args.join(
              " ",
            )} failed (${status})\n${stdout}\n${stderr}`,
          ),
        );
        return;
      }
      resolveRun({ stdout, stderr, status });
    });
  });
}

function writeFixture(root, entry) {
  const typescript = entry.language === "ts";
  const componentExtension = typescript ? "tsx" : "jsx";
  const configExtension = typescript ? "ts" : "mjs";
  const hasAppRouter = entry.router !== "pages";
  const hasPagesRouter = entry.router !== "app";
  if (hasAppRouter) mkdirSync(join(root, "app"), { recursive: true });
  if (hasPagesRouter) mkdirSync(join(root, "pages"), { recursive: true });
  writeFileSync(
    join(root, "package.json"),
    `${JSON.stringify(
      {
        name: `volato-${entry.next.replaceAll(".", "-")}-${entry.router}-${
          entry.language
        }-conformance`,
        private: true,
        scripts: { build: "next build" },
        dependencies: {
          next: entry.next,
          react: entry.react,
          "react-dom": entry.react,
        },
        ...(typescript
          ? {
              devDependencies: {
                "@types/node": "24.10.0",
                "@types/react": "19.2.17",
                "@types/react-dom": "19.2.3",
                typescript: "5.9.3",
              },
            }
          : {}),
      },
      null,
      2,
    )}\n`,
  );
  if (hasAppRouter) {
    writeFileSync(
      join(root, "app", `layout.${componentExtension}`),
      typescript
        ? `export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
`
        : `export default function RootLayout({ children }) {
  return <html lang="en"><body>{children}</body></html>;
}
`,
    );
    const appPageRoot =
      entry.router === "hybrid" ? join(root, "app", "app-home") : join(root, "app");
    mkdirSync(appPageRoot, { recursive: true });
    writeFileSync(
      join(appPageRoot, `page.${componentExtension}`),
      `export default function Page() {
  return <main>Volato conformance</main>;
}
`,
    );
    const appBrowserRoot = join(root, "app", "app-browser-crash");
    mkdirSync(appBrowserRoot, { recursive: true });
    writeFileSync(
      join(appBrowserRoot, `page.${componentExtension}`),
      `"use client";

import { useEffect, useState } from "react";

export default function AppBrowserCrash() {
  const [crash, setCrash] = useState(false);
  useEffect(() => {
    document.documentElement.dataset.volatoFixtureHydrated = "app";
  }, []);
  if (crash) throw new Error("Volato App browser render conformance");
  return <button id="volato-app-browser-crash" onClick={() => setCrash(true)}>Crash</button>;
}
`,
    );
    const appServerRoot = join(root, "app", "app-server-crash");
    mkdirSync(appServerRoot, { recursive: true });
    writeFileSync(
      join(appServerRoot, `page.${componentExtension}`),
      `export const dynamic = "force-dynamic";

export default function AppServerCrash() {
  throw new Error("Volato App server render conformance");
}
`,
    );
    const appApiRoot = join(root, "app", "api", "app-crash");
    mkdirSync(appApiRoot, { recursive: true });
    writeFileSync(
      join(appApiRoot, `route.${typescript ? "ts" : "js"}`),
      `import { wrapRoute } from "../../../volato/server${typescript ? "" : ".js"}";

export const GET = wrapRoute(async function GET() {
  throw new Error("Volato App Route Handler conformance");
});
`,
    );
  }
  if (hasPagesRouter) {
    mkdirSync(join(root, "pages", "api"), { recursive: true });
    writeFileSync(
      join(root, "pages", `index.${componentExtension}`),
      `export default function Page() {
  return <main>Volato Pages conformance</main>;
}
`,
    );
    writeFileSync(
      join(root, "pages", `_app.${componentExtension}`),
      typescript
        ? `import type { AppProps } from "next/app";

export default function ExistingApp({ Component, pageProps }: AppProps) {
  return <main data-pages-shell><Component {...pageProps} /></main>;
}
`
        : `export default function ExistingApp({ Component, pageProps }) {
  return <main data-pages-shell><Component {...pageProps} /></main>;
}
`,
    );
    writeFileSync(
      join(root, "pages", `_error.${componentExtension}`),
      typescript
        ? `import type { NextPageContext } from "next";

type ErrorProps = { statusCode: number };

function CustomError({ statusCode }: ErrorProps) {
  return <p>Custom Pages error {statusCode}</p>;
}

CustomError.getInitialProps = ({ res, err }: NextPageContext): ErrorProps => ({
  statusCode: res?.statusCode ?? (err as (Error & { statusCode?: number }) | undefined)?.statusCode ?? 500,
});

export default CustomError;
`
        : `function CustomError({ statusCode }) {
  return <p>Custom Pages error {statusCode}</p>;
}

CustomError.getInitialProps = ({ res, err }) => ({
  statusCode: res?.statusCode ?? err?.statusCode ?? 500,
});

export default CustomError;
`,
    );
    writeFileSync(
      join(root, "pages", `ssr-crash.${componentExtension}`),
      `export async function getServerSideProps() {
  throw new Error("Volato Pages SSR conformance");
}

export default function SsrCrash() {
  return null;
}
`,
    );
    writeFileSync(
      join(root, "pages", `browser-crash.${componentExtension}`),
      `import { useEffect, useState } from "react";

export default function BrowserCrash() {
  const [crash, setCrash] = useState(false);
  useEffect(() => {
    document.documentElement.dataset.volatoFixtureHydrated = "true";
  }, []);
  if (crash) throw new Error("Volato Pages browser render conformance");
  return <button id="volato-browser-crash" onClick={() => setCrash(true)}>Crash</button>;
}
`,
    );
    writeFileSync(
      join(root, "pages", "api", `crash.${typescript ? "ts" : "js"}`),
      typescript
        ? `import type { NextApiRequest, NextApiResponse } from "next";

export default function handler(_request: NextApiRequest, _response: NextApiResponse) {
  throw new Error("Volato Pages API conformance");
}
`
        : `export default function handler() {
  throw new Error("Volato Pages API conformance");
}
`,
    );
  }
  writeFileSync(
    join(root, `next.config.${configExtension}`),
    'export default { output: "standalone" };\n',
  );
  writeFileSync(join(root, ".gitignore"), "node_modules\n.next\n.env*.local\n");
  if (Number(entry.next.split(".")[0]) >= 16) {
    writeFileSync(
      join(root, `proxy.${typescript ? "ts" : "js"}`),
      `import { wrapProxy } from "./volato/server${typescript ? "" : ".js"}";

export const proxy = wrapProxy(async (request${
        typescript ? ": Request" : ""
      }) => {
  if (new URL(request.url).pathname === "/volato-proxy-crash") {
    throw new Error("Volato Next.js 16 proxy conformance");
  }
});

export const config = { matcher: "/volato-proxy-crash" };
`,
    );
  }
}

async function reservePort() {
  const probe = createServer();
  await new Promise((resolveListen, rejectListen) => {
    probe.once("error", rejectListen);
    probe.listen(0, "127.0.0.1", resolveListen);
  });
  const address = probe.address();
  assert(address && typeof address === "object", "Port probe did not bind.");
  await new Promise((resolveClose) => probe.close(resolveClose));
  return address.port;
}

async function startNextProduction(root) {
  const port = await reservePort();
  const standaloneRoot = join(root, ".next", "standalone");
  const standaloneEntry = join(standaloneRoot, "server.js");
  assert(
    existsSync(standaloneEntry),
    "Next.js production build did not emit its standalone server.",
  );
  const staticRoot = join(root, ".next", "static");
  if (existsSync(staticRoot)) {
    cpSync(staticRoot, join(standaloneRoot, ".next", "static"), {
      recursive: true,
    });
  }
  const publicRoot = join(root, "public");
  if (existsSync(publicRoot)) {
    cpSync(publicRoot, join(standaloneRoot, "public"), { recursive: true });
  }
  const child = spawn(
    process.execPath,
    [standaloneEntry],
    {
      cwd: standaloneRoot,
      env: {
        ...process.env,
        HOSTNAME: "127.0.0.1",
        PORT: String(port),
        NO_COLOR: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let logs = "";
  child.stdout.on("data", (chunk) => {
    logs += chunk;
  });
  child.stderr.on("data", (chunk) => {
    logs += chunk;
  });

  const origin = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Next.js production server exited early.\n${logs}`);
    }
    try {
      const response = await fetch(origin);
      if (response.ok) return { child, origin, logs: () => logs };
    } catch {
      // Server is still starting.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  child.kill("SIGTERM");
  throw new Error(`Next.js production server did not become ready.\n${logs}`);
}

async function stopNextProduction(child) {
  if (child.exitCode !== null) return;
  child.kill("SIGTERM");
  await new Promise((resolveExit) => {
    child.once("close", resolveExit);
    setTimeout(resolveExit, 5_000);
  });
}

async function waitForEventCount(count, logs, label) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (state.testEvents.length >= count) return;
    await new Promise((resolveWait) => setTimeout(resolveWait, 50));
  }
  throw new Error(`${label} timed out waiting for ingest.\n${logs()}`);
}

async function exerciseBrowserSurface(production, browser, entry, surface) {
  const page = await browser.newPage();
  try {
    await page.goto(`${production.origin}${surface.path}?token=browser-secret`);
    await page.waitForFunction(
      (hydrationMarker) =>
        document.documentElement.dataset.volatoFixtureHydrated ===
        hydrationMarker,
      surface.hydrationMarker,
    );

    const beforeWindowEvents = state.testEvents.length;
    await page.evaluate((message) => {
      const error = new Error(message);
      window.dispatchEvent(
        new ErrorEvent("error", { error, message: error.message }),
      );
    }, surface.windowMessage);
    await waitForEventCount(
      beforeWindowEvents + 1,
      production.logs,
      `${entry.label} ${surface.label} window witness`,
    );
    await new Promise((resolveWait) => setTimeout(resolveWait, 250));
    assert(
      state.testEvents.length === beforeWindowEvents + 1,
      `${entry.label} ${surface.label} installed duplicate window listeners.`,
    );
    const windowEvent = state.testEvents.at(-1);
    assert(
      windowEvent.message === surface.windowMessage &&
        windowEvent.runtime === "client" &&
        windowEvent.capturedVia === "window_error",
      `${entry.label} ${surface.label} window witness used an unexpected capture path: ${JSON.stringify(
        windowEvent,
      )}`,
    );

    const beforeRenderEvents = state.testEvents.length;
    await page.locator(surface.selector).click();
    await waitForEventCount(
      beforeRenderEvents + 1,
      production.logs,
      `${entry.label} ${surface.label} browser render`,
    );
    await new Promise((resolveWait) => setTimeout(resolveWait, 500));
    assert(
      state.testEvents.length === beforeRenderEvents + 1,
      `${entry.label} ${surface.label} browser render did not emit exactly one event.\n${production.logs()}`,
    );
    const renderEvent = state.testEvents.at(-1);
    assert(
      renderEvent.message === surface.renderMessage &&
        renderEvent.runtime === "client" &&
        renderEvent.capturedVia === "error_boundary",
      `${entry.label} ${surface.label} browser render used an unexpected capture path: ${JSON.stringify(
        renderEvent,
      )}`,
    );
    assert(
      !JSON.stringify(renderEvent).includes("browser-secret"),
      `${entry.label} ${surface.label} browser render leaked query values.`,
    );
  } finally {
    await page.close();
  }
}

async function exerciseServerSurface(production, entry, surface) {
  const beforeEvents = state.testEvents.length;
  const response = await fetch(
    `${production.origin}${surface.path}?token=server-secret`,
    {
      headers: {
        cookie: "session=server-secret",
        "user-agent": "volato-nextjs-conformance",
      },
    },
  );
  assert(
    !response.ok,
    `${entry.label} ${surface.path} did not preserve failure semantics.`,
  );
  await waitForEventCount(
    beforeEvents + 1,
    production.logs,
    `${entry.label} ${surface.label}`,
  );
  await new Promise((resolveWait) => setTimeout(resolveWait, 500));
  const emittedEvents = state.testEvents.slice(beforeEvents);
  const primaryEvents = emittedEvents.filter(
    (event) => event.message === surface.message,
  );
  const unexpectedEvents = emittedEvents.filter(
    (event) =>
      event.message !== surface.message &&
      !(surface.allowedSecondaryMessages ?? []).includes(event.message),
  );
  assert(
    primaryEvents.length === 1 && unexpectedEvents.length === 0,
    `${entry.label} ${surface.path} did not emit exactly one primary event: ${JSON.stringify(
      emittedEvents.map((event) => ({
        message: event.message,
        runtime: event.runtime,
        capturedVia: event.capturedVia,
      })),
    )}.\n${production.logs()}`,
  );
  const event = primaryEvents[0];
  assert(
    event.message === surface.message &&
      event.runtime === surface.runtime &&
      event.capturedVia === surface.capturedVia,
    `${entry.label} ${surface.path} used an unexpected capture path: ${JSON.stringify(
      event,
    )}`,
  );
  const serialized = JSON.stringify(event);
  assert(
    !serialized.includes("server-secret") && !serialized.includes("session="),
    `${entry.label} ${surface.path} leaked query or cookie values.`,
  );
}

const state = {
  testEvents: [],
  rejectTestEvents: false,
  sourcemaps: 0,
  sourcemapKeys: [],
  sourcemapDisplayPaths: [],
};

function multipartField(body, name) {
  return body.match(new RegExp(`name="${name}"\\r\\n\\r\\n([^\\r\\n]+)`))?.[1];
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  const browserOrigin =
    typeof req.headers.origin === "string" ? req.headers.origin : undefined;
  if (req.method === "OPTIONS" && url.pathname === "/api/ingest") {
    res.writeHead(204, {
      ...(browserOrigin
        ? { "access-control-allow-origin": browserOrigin }
        : {}),
      "access-control-allow-methods": "POST, OPTIONS",
      "access-control-allow-headers": "content-type, x-volato-dsn",
    });
    res.end();
    return;
  }
  const setupMatch = url.pathname.match(
    /^\/v1\/projects\/([0-9a-f-]+)\/setup$/,
  );
  if (req.method === "GET" && setupMatch) {
    if (req.headers.authorization !== `Bearer ${AUTH_TOKEN}`) {
      res.writeHead(401, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "invalid_token" }));
      return;
    }
    const projectId = setupMatch[1];
    const origin = `http://127.0.0.1:${server.address().port}`;
    res.writeHead(200, {
      "content-type": "application/json",
      "cache-control": "no-store",
    });
    res.end(
      JSON.stringify({
        data: {
          projectId,
          projectName: "Conformance",
          dsn: `http://public@127.0.0.1:${server.address().port}/${projectId}`,
          ingestToken: INGEST_TOKEN,
        },
      }),
    );
    return;
  }
  const linkedMatch = url.pathname.match(
    /^\/v1\/projects\/([0-9a-f-]+)\/linked$/,
  );
  if (req.method === "POST" && linkedMatch) {
    if (req.headers.authorization !== `Bearer ${AUTH_TOKEN}`) {
      res.writeHead(401, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "invalid_token" }));
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        data: { projectId: linkedMatch[1], linked: true, tracked: true },
      }),
    );
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/ingest") {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      if (state.rejectTestEvents) {
        res.writeHead(401, {
          "content-type": "application/json",
          ...(browserOrigin
            ? { "access-control-allow-origin": browserOrigin }
            : {}),
        });
        res.end(JSON.stringify({ error: "invalid_dsn" }));
      } else {
        state.testEvents.push(JSON.parse(body));
        res.writeHead(202, {
          "content-type": "application/json",
          ...(browserOrigin
            ? { "access-control-allow-origin": browserOrigin }
            : {}),
        });
        res.end(JSON.stringify({ accepted: true }));
      }
    });
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/sourcemaps") {
    if (req.headers.authorization !== `Bearer ${INGEST_TOKEN}`) {
      res.writeHead(401);
      res.end();
      return;
    }
    const chunks = [];
    req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    req.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf8");
      const release = multipartField(body, "release");
      const filenameHash = multipartField(body, "filename_hash");
      const displayPath = multipartField(body, "display_path");
      if (!release || !filenameHash) {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "invalid_multipart" }));
        return;
      }
      const key = `${release}:${filenameHash}`;
      const duplicate = state.sourcemapKeys.includes(key);
      state.sourcemaps += 1;
      state.sourcemapKeys.push(key);
      if (displayPath) state.sourcemapDisplayPaths.push(displayPath);
      res.writeHead(duplicate ? 200 : 201, {
        "content-type": "application/json",
      });
      res.end(JSON.stringify({ stored: true }));
    });
    return;
  }
  res.writeHead(404);
  res.end();
});

try {
  cliRunner = resolveCli();
  console.log(`Exercising CLI: ${cliRunner.label}`);
  await new Promise((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const address = server.address();
  assert(address && typeof address === "object", "Mock API did not bind.");
  const apiOrigin = `http://127.0.0.1:${address.port}`;

  for (const [index, entry] of MATRIX.entries()) {
    const fixture = join(
      scratch,
      `next-${entry.next}-${entry.router}-${entry.language}`,
    );
    const projectId = `00000000-0000-4000-8000-00000000000${index + 1}`;
    writeFixture(fixture, entry);

    await run("pnpm", ["install", "--ignore-scripts"], { cwd: fixture });
    const bootstrap = await runCli(["init", "--project", projectId, "--yes"], {
      cwd: fixture,
      env: {
        VOLATO_API_URL: apiOrigin,
        VOLATO_TOKEN: AUTH_TOKEN,
      },
    });
    const beforeEvents = state.testEvents.length;
    const init = await runCli(
      ["errors", "init", "--yes", "--send-test-event"],
      {
        cwd: fixture,
        env: {
          VOLATO_API_URL: apiOrigin,
          VOLATO_TOKEN: AUTH_TOKEN,
        },
      },
    );
    assert(
      state.testEvents.length === beforeEvents + 1,
      `${entry.label} setup did not send its test event.\n${init.stdout}\n${init.stderr}`,
    );
    const testEvent = state.testEvents.at(-1);
    assert(
      testEvent.message ===
        "Volato integration test — generated Next.js runtime",
      `${entry.label} setup bypassed the generated integration.`,
    );
    assert(
      typeof testEvent.stack === "string" &&
        testEvent.stack.includes("Volato integration test") &&
        testEvent.stack.includes("\n    at "),
      `${entry.label} setup test event did not include an Error stack.`,
    );
    assert(
      testEvent.runtime === "route_handler" &&
        testEvent.capturedVia === "manual",
      `${entry.label} setup test event did not use the generated server capture path.`,
    );
    const verificationApiRoot = join(
      fixture,
      entry.router === "pages" ? "pages" : "app",
      "api",
    );
    assert(
      !existsSync(verificationApiRoot) ||
        !readdirSync(verificationApiRoot).some((name) =>
          name.startsWith("volato-verify-"),
        ),
      `${entry.label} setup left its temporary verification route behind.`,
    );
    assert(
      !`${bootstrap.stdout}${bootstrap.stderr}${init.stdout}${init.stderr}`.includes(
        INGEST_TOKEN,
      ),
      `${entry.label} setup printed the ingest token.`,
    );
    const componentExtension = entry.language === "ts" ? "tsx" : "jsx";
    const runtimeExtension = entry.language === "ts" ? "ts" : "js";
    const routerFiles = [
      ...(entry.router !== "pages"
        ? [`app/error.${componentExtension}`]
        : []),
      ...(entry.router !== "app"
        ? [
            `pages/_app.${componentExtension}`,
            `pages/_error.${componentExtension}`,
          ]
        : []),
    ];
    for (const required of [
      ".agents/skills/volato-setup/SKILL.md",
      ".agents/skills/volato-errors/SKILL.md",
      ".agents/skills/volato-nextjs/SKILL.md",
      ".volato/manifest.json",
      ".env.local",
      ".gitignore",
      ...routerFiles,
      `instrumentation.${runtimeExtension}`,
      `volato/server.${runtimeExtension}`,
    ]) {
      assert(
        existsSync(join(fixture, required)),
        `${entry.label} setup did not create ${required}.`,
      );
    }
    assert(
      init.stdout.includes(
        "Volato Errors is ready. Deploy these changes; the dashboard will surface the first production error when it arrives.",
      ),
      `${entry.label} setup did not hand off to deployment.`,
    );
    const envLocal = readFileSync(join(fixture, ".env.local"), "utf8");
    assert(
      envLocal.includes("NEXT_PUBLIC_VOLATO_DSN=") &&
        envLocal.includes(`VOLATO_INGEST_TOKEN=${INGEST_TOKEN}`),
      `${entry.label} setup did not write both credentials.`,
    );
    assert(
      readFileSync(join(fixture, ".gitignore"), "utf8").includes(".env*.local"),
      `${entry.label} setup did not protect local credentials.`,
    );
    const manifest = JSON.parse(
      readFileSync(join(fixture, ".volato", "manifest.json"), "utf8"),
    );
    assert(
      manifest.schemaVersion === 2 &&
        manifest.project.id === projectId &&
        manifest.integrations["errors-nextjs"],
      `${entry.label} setup did not preserve the Errors integration entry.`,
    );
    if (entry.language === "js") {
      const generatedTypescript = [
        ...filesWithSuffix(join(fixture, "volato"), ".ts"),
        ...filesWithSuffix(join(fixture, "volato"), ".tsx"),
      ];
      assert(
        generatedTypescript.length === 0,
        `${
          entry.label
        } emitted TypeScript into a JavaScript repository:\n${generatedTypescript.join(
          "\n",
        )}`,
      );
      const fixturePackage = JSON.parse(
        readFileSync(join(fixture, "package.json"), "utf8"),
      );
      assert(
        !fixturePackage.devDependencies?.typescript,
        `${entry.label} unexpectedly required TypeScript.`,
      );
      const browserEntries = [
        ...(entry.router !== "pages"
          ? [join(fixture, "app", "layout.jsx")]
          : []),
        ...(entry.router !== "app"
          ? [join(fixture, "pages", "_app.jsx")]
          : []),
      ];
      for (const browserEntry of browserEntries) {
        assert(
          !readFileSync(browserEntry, "utf8").includes(
            "NEXT_PUBLIC_VOLATO_DSN!",
          ),
          `${entry.label} left a TypeScript non-null assertion in ${browserEntry}.`,
        );
      }
    }

    if (index === 0) {
      state.rejectTestEvents = true;
      const rejected = await runCli(
        ["errors", "init", "--yes", "--send-test-event"],
        {
          cwd: fixture,
          env: {
            VOLATO_API_URL: apiOrigin,
            VOLATO_TOKEN: AUTH_TOKEN,
          },
          allowFailure: true,
        },
      );
      state.rejectTestEvents = false;
      assert(
        rejected.status !== 0 &&
          `${rejected.stdout}${rejected.stderr}`.includes(
            "ingest did not accept the generated capture",
          ) &&
          !`${rejected.stdout}${rejected.stderr}`.includes(
            "captured a test error with a stack",
          ),
        `${entry.label} setup reported a false success after ingest rejected the event.`,
      );
      assert(
        !existsSync(verificationApiRoot) ||
          !readdirSync(verificationApiRoot).some((name) =>
            name.startsWith("volato-verify-"),
          ),
        `${entry.label} failed verification left its temporary route behind.`,
      );
    }

    // Commit the generated integration so `withVolato()` must derive the
    // actual checkout SHA. The user never configures or publishes a release.
    await run("git", ["init", "-q"], { cwd: fixture });
    await run("git", ["config", "user.name", "Volato Conformance"], {
      cwd: fixture,
    });
    await run("git", ["config", "user.email", "conformance@volato.dev"], {
      cwd: fixture,
    });
    await run("git", ["add", "."], { cwd: fixture });
    await run("git", ["commit", "-qm", "conformance fixture"], {
      cwd: fixture,
    });

    const beforeMaps = state.sourcemaps;
    const beforeMapKeys = state.sourcemapKeys.length;
    await run("pnpm", ["build"], { cwd: fixture });
    assert(
      state.sourcemaps > beforeMaps,
      `${entry.label} build uploaded no sourcemaps.`,
    );
    const uploadedKeys = state.sourcemapKeys.slice(beforeMapKeys);
    assert(
      new Set(uploadedKeys).size === uploadedKeys.length,
      `${entry.label} build uploaded duplicate sourcemaps across webpack compilers.`,
    );
    assert(
      existsSync(join(fixture, ".next", "standalone")),
      `${entry.label} build did not assemble standalone output.`,
    );
    const publicMaps = filesWithSuffix(
      join(fixture, ".next", "static"),
      ".js.map",
    );
    assert(
      publicMaps.length === 0,
      `${
        entry.label
      } build left browser sourcemaps in public static output:\n${publicMaps.join(
        "\n",
      )}\nUploaded paths:\n${state.sourcemapDisplayPaths.join("\n")}`,
    );
    assert(
      filesWithSuffix(join(fixture, ".next", "server"), ".js.map").length > 0,
      `${entry.label} build removed private server sourcemaps before standalone assembly.`,
    );
    const production = await startNextProduction(fixture);
    try {
      const browser = await chromium.launch({ headless: true });
      try {
        if (entry.router !== "pages") {
          await exerciseBrowserSurface(production, browser, entry, {
            label: "App Router",
            path: "/app-browser-crash",
            hydrationMarker: "app",
            selector: "#volato-app-browser-crash",
            windowMessage: "Volato App window witness",
            renderMessage: "Volato App browser render conformance",
          });
        }
        if (entry.router !== "app") {
          await exerciseBrowserSurface(production, browser, entry, {
            label: "Pages Router",
            path: "/browser-crash",
            hydrationMarker: "true",
            selector: "#volato-browser-crash",
            windowMessage: "Volato Pages window witness",
            renderMessage: "Volato Pages browser render conformance",
          });
        }
      } finally {
        await browser.close();
      }

      if (entry.router !== "pages") {
        for (const surface of [
          {
            label: "App Router server render",
            path: "/app-server-crash",
            message: "Volato App server render conformance",
            runtime: "rsc",
            capturedVia: "on_request_error",
          },
          {
            label: "App Route Handler",
            path: "/api/app-crash",
            message: "Volato App Route Handler conformance",
            runtime: "route_handler",
            capturedVia: "wrap_route",
          },
        ]) {
          await exerciseServerSurface(production, entry, surface);
        }
      }
      if (entry.router !== "app") {
        for (const surface of [
          {
            label: "Pages Router SSR",
            path: "/ssr-crash",
            message: "Volato Pages SSR conformance",
            runtime: "pages_render",
            capturedVia: "on_request_error",
          },
          {
            label: "Pages API Route",
            path: "/api/crash",
            message: "Volato Pages API conformance",
            runtime: "route_handler",
            capturedVia: "on_request_error",
          },
        ]) {
          await exerciseServerSurface(production, entry, surface);
        }
      }
      if (entry.next.startsWith("16.")) {
        await exerciseServerSurface(production, entry, {
          label: "Next.js 16 proxy",
          path: "/volato-proxy-crash",
          message: "Volato Next.js 16 proxy conformance",
          runtime: "middleware",
          capturedVia: "wrap_middleware",
          // Next.js 16 emits a separate ERR_HTTP_HEADERS_SENT cascade after
          // rethrowing a proxy failure. It is a real second error, not a
          // duplicate of the wrapped failure, so Volato must not hide it.
          allowedSecondaryMessages: [
            "Cannot append headers after they are sent to the client",
          ],
        });
      }
    } finally {
      await stopNextProduction(production.child);
    }
    process.stdout.write(
      `✓ ${entry.label} ${entry.next}: authenticated init + production build\n`,
    );
  }
} finally {
  await new Promise((resolveClose) => server.close(resolveClose));
  if (process.env.VOLATO_KEEP_CONFORMANCE === "1") {
    process.stderr.write(`Conformance scratch kept at ${scratch}\n`);
  } else {
    rmSync(scratch, { recursive: true, force: true });
  }
}
