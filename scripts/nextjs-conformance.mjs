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
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { TraceMap, originalPositionFor } from "@jridgewell/trace-mapping";
import { chromium } from "playwright";
import { projectFramePath } from "../packages/cli/skills/volato-nextjs/assets/runtime/protocol.ts";
import { NEXTJS_CONFORMANCE_MATRIX } from "./nextjs-conformance-matrix.mjs";

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
const requestedNextVersion = process.env.VOLATO_NEXTJS_VERSION;
const requestedLanguage = process.env.VOLATO_NEXTJS_LANGUAGE;
const requestedRouter = process.env.VOLATO_NEXTJS_ROUTER;
const MATRIX = NEXTJS_CONFORMANCE_MATRIX.filter(
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

function localFixtureModule(fromFile, targetFile) {
  let specifier = relative(dirname(fromFile), targetFile).replaceAll("\\", "/");
  if (!specifier.startsWith(".")) specifier = `./${specifier}`;
  return specifier;
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
  const hasAppRouter = entry.router !== "pages";
  const hasPagesRouter = entry.router !== "app";
  const appRoot = entry.appDir ? join(root, entry.appDir) : null;
  const pagesRoot = entry.pagesDir ? join(root, entry.pagesDir) : null;
  const runtimeRelativeRoot =
    entry.appDir?.startsWith("src/") || entry.pagesDir?.startsWith("src/")
      ? "src/volato"
      : "volato";
  const frameworkRelativeRoot = entry.pagesDir ?? entry.appDir;
  const frameworkRoot = frameworkRelativeRoot?.startsWith("src/")
    ? join(root, "src")
    : root;
  if (appRoot) mkdirSync(appRoot, { recursive: true });
  if (pagesRoot) mkdirSync(pagesRoot, { recursive: true });
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
  if (entry.existingInstrumentation) {
    writeFileSync(
      join(frameworkRoot, `instrumentation.${typescript ? "ts" : "js"}`),
      `export function register() {
  // existing-instrumentation-marker
}
`,
    );
  }
  if (hasAppRouter) {
    assert(appRoot, `${entry.label} has no App Router root.`);
    writeFileSync(
      join(appRoot, `layout.${componentExtension}`),
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
      entry.router === "hybrid" ? join(appRoot, "app-home") : appRoot;
    mkdirSync(appPageRoot, { recursive: true });
    writeFileSync(
      join(appPageRoot, `page.${componentExtension}`),
      `export default function Page() {
  return <main>Volato conformance</main>;
}
`,
    );
    const appBrowserRoot = join(appRoot, "app-browser-crash");
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
  return (
    <main>
      <button id="volato-app-window-crash" onClick={() => setTimeout(() => {
        throw new Error("Volato App window witness");
      }, 0)}>Window crash</button>
      <button id="volato-app-browser-crash" onClick={() => setCrash(true)}>Render crash</button>
    </main>
  );
}
`,
    );
    const appServerRoot = join(appRoot, "app-server-crash");
    mkdirSync(appServerRoot, { recursive: true });
    writeFileSync(
      join(appServerRoot, `page.${componentExtension}`),
      `export const dynamic = "force-dynamic";

export default function AppServerCrash() {
  throw new Error("Volato App server render conformance");
}
`,
    );
    const appApiRoot = join(appRoot, "api", "app-crash");
    mkdirSync(appApiRoot, { recursive: true });
    const appRoutePath = join(
      appApiRoot,
      `route.${typescript ? "ts" : "js"}`,
    );
    writeFileSync(
      appRoutePath,
      `import { wrapRoute } from ${JSON.stringify(
        localFixtureModule(
          appRoutePath,
          join(
            root,
            runtimeRelativeRoot,
            `server${typescript ? "" : ".js"}`,
          ),
        ),
      )};

export const GET = wrapRoute(async function GET() {
  throw new Error("Volato App Route Handler conformance");
});
`,
    );
    const appActionRoot = join(appRoot, "app-action");
    mkdirSync(appActionRoot, { recursive: true });
    const appActionPath = join(
      appActionRoot,
      `page.${componentExtension}`,
    );
    writeFileSync(
      appActionPath,
      `import { reportActionError } from ${JSON.stringify(
        localFixtureModule(
          appActionPath,
          join(
            root,
            runtimeRelativeRoot,
            `server${typescript ? "" : ".js"}`,
          ),
        ),
      )};

async function throwAction() {
  "use server";
  throw new Error("Volato App Server Action throw conformance");
}

async function reportAction() {
  "use server";
  await reportActionError(
    new Error("Volato App Server Action returned failure conformance"),
    { name: "conformance-returned-failure" },
  );
}

export default function AppActionPage() {
  return (
    <main>
      <form action={throwAction}>
        <button id="volato-action-throw" type="submit">Throw</button>
      </form>
      <form action={reportAction}>
        <button id="volato-action-report" type="submit">Report</button>
      </form>
    </main>
  );
}
`,
    );
  }
  if (hasPagesRouter) {
    assert(pagesRoot, `${entry.label} has no Pages Router root.`);
    mkdirSync(join(pagesRoot, "api"), { recursive: true });
    writeFileSync(
      join(pagesRoot, `index.${componentExtension}`),
      `export default function Page() {
  return <main>Volato Pages conformance</main>;
}
`,
    );
    writeFileSync(
      join(pagesRoot, `_app.${componentExtension}`),
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
      join(pagesRoot, `_error.${componentExtension}`),
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
      join(pagesRoot, `ssr-crash.${componentExtension}`),
      `export async function getServerSideProps() {
  throw new Error("Volato Pages SSR conformance");
}

export default function SsrCrash() {
  return null;
}
`,
    );
    writeFileSync(
      join(pagesRoot, `browser-crash.${componentExtension}`),
      `import { useEffect, useState } from "react";

export default function BrowserCrash() {
  const [crash, setCrash] = useState(false);
  useEffect(() => {
    document.documentElement.dataset.volatoFixtureHydrated = "true";
  }, []);
  if (crash) throw new Error("Volato Pages browser render conformance");
  return (
    <main>
      <button id="volato-pages-window-crash" onClick={() => setTimeout(() => {
        throw new Error("Volato Pages window witness");
      }, 0)}>Window crash</button>
      <button id="volato-browser-crash" onClick={() => setCrash(true)}>Render crash</button>
    </main>
  );
}
`,
    );
    writeFileSync(
      join(pagesRoot, `static-crash.${componentExtension}`),
      `export async function getStaticProps() {
  if (process.env.VOLATO_CONFORMANCE_STATIC_FAILURE === "1") {
    throw new Error("Volato Pages getStaticProps build conformance");
  }
  return { props: {} };
}

export default function StaticCrash() {
  return <main>Static lifecycle fixture</main>;
}
`,
    );
    writeFileSync(
      join(pagesRoot, "api", `crash.${typescript ? "ts" : "js"}`),
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
  if (entry.configKind === "commonjs") {
    writeFileSync(
      join(root, "next.config.js"),
      'module.exports = async () => ({ output: "standalone" });\n',
    );
  } else if (entry.configKind === "typescript") {
    writeFileSync(
      join(root, "next.config.ts"),
      'export default { output: "standalone" };\n',
    );
  }
  writeFileSync(join(root, ".gitignore"), "node_modules\n.next\n.env*.local\n");
  if (Number(entry.next.split(".")[0]) >= 16) {
    const proxyPath = join(frameworkRoot, `proxy.${typescript ? "ts" : "js"}`);
    writeFileSync(
      proxyPath,
      `import { wrapProxy } from ${JSON.stringify(
        localFixtureModule(
          proxyPath,
          join(
            root,
            runtimeRelativeRoot,
            `server${typescript ? "" : ".js"}`,
          ),
        ),
      )};

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
  } else {
    const middlewarePath = join(
      frameworkRoot,
      `middleware.${typescript ? "ts" : "js"}`,
    );
    writeFileSync(
      middlewarePath,
      `import { wrapMiddleware } from ${JSON.stringify(
        localFixtureModule(
          middlewarePath,
          join(
            root,
            runtimeRelativeRoot,
            `middleware${typescript ? "" : ".js"}`,
          ),
        ),
      )};

export default wrapMiddleware(async () => {
  throw new Error("Volato Next.js 15 middleware conformance");
}, {
  dsn: process.env.NEXT_PUBLIC_VOLATO_DSN${typescript ? "!" : ""},
  release: process.env.NEXT_PUBLIC_VOLATO_RELEASE,
  commitSha: process.env.NEXT_PUBLIC_VOLATO_COMMIT_SHA,
  environment: process.env.NODE_ENV,
});

export const config = { matcher: "/volato-middleware-crash" };
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
  const standalone = existsSync(standaloneEntry);
  if (standalone) {
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
  }
  const child = spawn(
    standalone ? process.execPath : "pnpm",
    standalone
      ? [standaloneEntry]
      : ["exec", "next", "start", "-H", "127.0.0.1", "-p", String(port)],
    {
      cwd: standalone ? standaloneRoot : root,
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
      if (response.ok) return { child, origin, root, logs: () => logs };
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

const STACK_FRAME_PARENS = /at\s+.*?\((.+):(\d+):(\d+)\)$/;
const STACK_FRAME_BARE = /at\s+([^\s]+):(\d+):(\d+)/;

function stackFrames(stack) {
  if (typeof stack !== "string") return [];
  return stack.split("\n").flatMap((line) => {
    const match = STACK_FRAME_PARENS.exec(line) ?? STACK_FRAME_BARE.exec(line);
    if (!match?.[1] || !match[2] || !match[3]) return [];
    return [
      {
        path: match[1],
        line: Number(match[2]),
        column: Number(match[3]),
      },
    ];
  });
}

function normalizedSourceSuffix(source) {
  let value = source.trim().replaceAll("\\", "/").replace(/[?#].*$/, "");
  if (value.startsWith("file://")) value = value.slice("file://".length);
  if (value.startsWith("webpack://")) {
    value = value.slice("webpack://".length).replace(/^\/+/, "");
    const moduleMarker = value.indexOf("/./");
    if (moduleMarker >= 0) value = value.slice(moduleMarker + 3);
  }
  return value.replace(/^\.\//, "").replace(/^\/+/, "");
}

function sourcePathMatches(source, expectedPath) {
  const normalized = normalizedSourceSuffix(source);
  return normalized === expectedPath || normalized.endsWith(`/${expectedPath}`);
}

function expectedSourceLine(root, expectation) {
  const source = readFileSync(join(root, expectation.path), "utf8");
  const lines = source.split("\n");
  const matches = lines.flatMap((line, index) =>
    line.includes(expectation.marker) ? [index + 1] : [],
  );
  assert(
    matches.length === 1,
    `${expectation.path} must contain one source marker ${expectation.marker}.`,
  );
  return matches[0];
}

function assertEventSource(event, root, entry, label, expectation) {
  const expectedLine = expectedSourceLine(root, expectation);
  const frames = stackFrames(event.stack);
  assert(frames.length > 0, `${entry.label} ${label} has no parseable stack.`);

  for (const frame of frames) {
    if (
      sourcePathMatches(frame.path, expectation.path) &&
      frame.line === expectedLine
    ) {
      state.sourceChecks += 1;
      state.directSourceChecks += 1;
      return;
    }

    const key = projectFramePath(frame.path);
    if (!key || typeof event.release !== "string") continue;
    const uploaded = state.sourceMapByKey.get(
      `${event.release}:${key.filename_hash}`,
    );
    if (!uploaded) continue;
    const original = originalPositionFor(uploaded.consumer, {
      line: frame.line,
      column: frame.column,
    });
    if (
      original.source &&
      original.line === expectedLine &&
      sourcePathMatches(original.source, expectation.path)
    ) {
      state.sourceChecks += 1;
      state.mappedSourceChecks += 1;
      return;
    }
  }

  throw new Error(
    `${entry.label} ${label} did not resolve to ${expectation.path}:${expectedLine}.\n` +
      `Stack:\n${String(event.stack)}\n` +
      `Uploaded maps:\n${state.sourcemapDisplayPaths.join("\n")}`,
  );
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
    await page.locator(surface.windowSelector).click();
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
    assert(
      !JSON.stringify(windowEvent).includes("browser-secret"),
      `${entry.label} ${surface.label} window witness leaked query values.`,
    );
    assertEventSource(
      windowEvent,
      production.root,
      entry,
      `${surface.label} window witness`,
      surface.windowSource,
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
    assertEventSource(
      renderEvent,
      production.root,
      entry,
      `${surface.label} browser render`,
      surface.renderSource,
    );
  } finally {
    await page.close();
  }
}

async function exerciseActionSurface(production, browser, entry, surface) {
  const page = await browser.newPage();
  try {
    await page.goto(`${production.origin}/app-action?token=action-secret`);
    const beforeEvents = state.testEvents.length;
    await page.locator(surface.selector).click();
    await waitForEventCount(
      beforeEvents + 1,
      production.logs,
      `${entry.label} ${surface.label}`,
    );
    if (surface.throws) {
      await page.getByText("Something went wrong").waitFor();
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 500));
    const emittedEvents = state.testEvents.slice(beforeEvents);
    const actionEvents = emittedEvents.filter(
      (event) =>
        event.message === surface.message && event.runtime === "server_action",
    );
    assert(
      actionEvents.length === 1,
      `${entry.label} ${surface.label} did not emit exactly one Server Action event: ${JSON.stringify(
        emittedEvents.map((event) => ({
          message: event.message,
          runtime: event.runtime,
          capturedVia: event.capturedVia,
        })),
      )}.\n${production.logs()}`,
    );
    const event = actionEvents[0];
    assert(
      event.capturedVia === surface.capturedVia,
      `${entry.label} ${surface.label} used ${event.capturedVia} instead of ${surface.capturedVia}.`,
    );
    assert(
      !JSON.stringify(event).includes("action-secret"),
      `${entry.label} ${surface.label} leaked query values.`,
    );
    assertEventSource(
      event,
      production.root,
      entry,
      surface.label,
      surface.source,
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
  assertEventSource(
    event,
    production.root,
    entry,
    surface.label,
    surface.source,
  );
}

const state = {
  testEvents: [],
  rejectTestEvents: false,
  sourcemaps: 0,
  sourcemapKeys: [],
  sourcemapDisplayPaths: [],
  sourceMapByKey: new Map(),
  sourceChecks: 0,
  directSourceChecks: 0,
  mappedSourceChecks: 0,
};

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
      void (async () => {
        try {
          const contentType = req.headers["content-type"];
          if (typeof contentType !== "string") {
            throw new Error("missing multipart content type");
          }
          const form = await new Response(Buffer.concat(chunks), {
            headers: { "content-type": contentType },
          }).formData();
          const release = form.get("release");
          const filenameHash = form.get("filename_hash");
          const displayPath = form.get("display_path");
          const mapFile = form.get("map");
          if (
            typeof release !== "string" ||
            typeof filenameHash !== "string" ||
            typeof displayPath !== "string" ||
            !mapFile ||
            typeof mapFile === "string"
          ) {
            throw new Error("invalid multipart fields");
          }
          const map = JSON.parse(await mapFile.text());
          if ("sourcesContent" in map) {
            throw new Error("uploaded sourcemap retained sourcesContent");
          }
          const key = `${release}:${filenameHash}`;
          const duplicate = state.sourceMapByKey.has(key);
          state.sourcemaps += 1;
          state.sourcemapKeys.push(key);
          state.sourcemapDisplayPaths.push(displayPath);
          state.sourceMapByKey.set(key, {
            consumer: new TraceMap(map),
            displayPath,
          });
          res.writeHead(duplicate ? 200 : 201, {
            "content-type": "application/json",
          });
          res.end(JSON.stringify({ stored: true }));
        } catch (error) {
          res.writeHead(400, { "content-type": "application/json" });
          res.end(
            JSON.stringify({
              error: error instanceof Error ? error.message : String(error),
            }),
          );
        }
      })();
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
  let staticLifecycleChecked = false;

  for (const [index, entry] of MATRIX.entries()) {
    const fixture = join(
      scratch,
      `next-${entry.next}-${entry.router}-${entry.language}`,
    );
    const projectId = `00000000-0000-4000-8000-${String(index + 1).padStart(
      12,
      "0",
    )}`;
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
      entry.router === "pages" ? entry.pagesDir : entry.appDir,
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
    const runtimeRelativeRoot =
      entry.appDir?.startsWith("src/") || entry.pagesDir?.startsWith("src/")
        ? "src/volato"
        : "volato";
    const frameworkRelativeRoot = entry.pagesDir ?? entry.appDir;
    const instrumentationRelativeRoot = frameworkRelativeRoot?.startsWith(
      "src/",
    )
      ? "src"
      : "";
    const routerFiles = [
      ...(entry.router !== "pages"
        ? [`${entry.appDir}/error.${componentExtension}`]
        : []),
      ...(entry.router !== "app"
        ? [
            `${entry.pagesDir}/_app.${componentExtension}`,
            `${entry.pagesDir}/_error.${componentExtension}`,
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
      `${instrumentationRelativeRoot ? `${instrumentationRelativeRoot}/` : ""}instrumentation.${runtimeExtension}`,
      `${runtimeRelativeRoot}/server.${runtimeExtension}`,
      `${runtimeRelativeRoot}/withVolato.cjs`,
    ]) {
      assert(
        existsSync(join(fixture, required)),
        `${entry.label} setup did not create ${required}.`,
      );
    }
    if (entry.existingInstrumentation) {
      const instrumentationSource = readFileSync(
        join(
          fixture,
          instrumentationRelativeRoot,
          `instrumentation.${runtimeExtension}`,
        ),
        "utf8",
      );
      assert(
        instrumentationSource.includes("existing-instrumentation-marker") &&
          instrumentationSource.includes("onRequestError") &&
          instrumentationSource.includes("volato/instrumentation"),
        `${entry.label} did not preserve and compose existing instrumentation.`,
      );
    }
    assert(
      init.stdout.includes(
        "Volato Errors files are composed. Run the production build and applicable capture checks before deployment.",
      ),
      `${entry.label} setup claimed readiness before production verification.`,
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
    const configPath = join(
      fixture,
      entry.configKind === "commonjs"
        ? "next.config.js"
        : entry.configKind === "missing"
          ? "next.config.mjs"
          : "next.config.ts",
    );
    assert(
      existsSync(configPath),
      `${entry.label} setup did not leave an executable Next.js config.`,
    );
    const configSource = readFileSync(configPath, "utf8");
    assert(
      configSource.includes("withVolato.cjs") &&
        (entry.configKind !== "commonjs" ||
          configSource.includes("require(")),
      `${entry.label} config did not compose the dependency-free build helper.`,
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
        ...filesWithSuffix(join(fixture, runtimeRelativeRoot), ".ts"),
        ...filesWithSuffix(join(fixture, runtimeRelativeRoot), ".tsx"),
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
          ? [join(fixture, entry.appDir, "layout.jsx")]
          : []),
        ...(entry.router !== "app"
          ? [join(fixture, entry.pagesDir, "_app.jsx")]
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
      existsSync(join(fixture, ".next", "standalone")) ===
        (entry.configKind !== "missing"),
      `${entry.label} build changed the application's standalone topology.`,
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
    const beforeSourceChecks = state.sourceChecks;
    const beforeMappedSourceChecks = state.mappedSourceChecks;
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
            windowSelector: "#volato-app-window-crash",
            windowMessage: "Volato App window witness",
            renderMessage: "Volato App browser render conformance",
            windowSource: {
              path: `${entry.appDir}/app-browser-crash/page.${componentExtension}`,
              marker: 'throw new Error("Volato App window witness")',
            },
            renderSource: {
              path: `${entry.appDir}/app-browser-crash/page.${componentExtension}`,
              marker:
                'throw new Error("Volato App browser render conformance")',
            },
          });
          await exerciseActionSurface(production, browser, entry, {
            label: "thrown Server Action",
            selector: "#volato-action-throw",
            message: "Volato App Server Action throw conformance",
            capturedVia: "on_request_error",
            throws: true,
            source: {
              path: `${entry.appDir}/app-action/page.${componentExtension}`,
              marker:
                'throw new Error("Volato App Server Action throw conformance")',
            },
          });
          await exerciseActionSurface(production, browser, entry, {
            label: "returned Server Action failure",
            selector: "#volato-action-report",
            message: "Volato App Server Action returned failure conformance",
            capturedVia: "wrap_action",
            throws: false,
            source: {
              path: `${entry.appDir}/app-action/page.${componentExtension}`,
              marker:
                'new Error("Volato App Server Action returned failure conformance")',
            },
          });
        }
        if (entry.router !== "app") {
          await exerciseBrowserSurface(production, browser, entry, {
            label: "Pages Router",
            path: "/browser-crash",
            hydrationMarker: "true",
            selector: "#volato-browser-crash",
            windowSelector: "#volato-pages-window-crash",
            windowMessage: "Volato Pages window witness",
            renderMessage: "Volato Pages browser render conformance",
            windowSource: {
              path: `${entry.pagesDir}/browser-crash.${componentExtension}`,
              marker: 'throw new Error("Volato Pages window witness")',
            },
            renderSource: {
              path: `${entry.pagesDir}/browser-crash.${componentExtension}`,
              marker:
                'throw new Error("Volato Pages browser render conformance")',
            },
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
            source: {
              path: `${entry.appDir}/app-server-crash/page.${componentExtension}`,
              marker:
                'throw new Error("Volato App server render conformance")',
            },
          },
          {
            label: "App Route Handler",
            path: "/api/app-crash",
            message: "Volato App Route Handler conformance",
            runtime: "route_handler",
            capturedVia: "wrap_route",
            source: {
              path: `${entry.appDir}/api/app-crash/route.${runtimeExtension}`,
              marker:
                'throw new Error("Volato App Route Handler conformance")',
            },
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
            source: {
              path: `${entry.pagesDir}/ssr-crash.${componentExtension}`,
              marker: 'throw new Error("Volato Pages SSR conformance")',
            },
          },
          {
            label: "Pages API Route",
            path: "/api/crash",
            message: "Volato Pages API conformance",
            runtime: "route_handler",
            capturedVia: "on_request_error",
            source: {
              path: `${entry.pagesDir}/api/crash.${runtimeExtension}`,
              marker: 'throw new Error("Volato Pages API conformance")',
            },
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
          source: {
            path: `${instrumentationRelativeRoot ? `${instrumentationRelativeRoot}/` : ""}proxy.${runtimeExtension}`,
            marker: 'throw new Error("Volato Next.js 16 proxy conformance")',
          },
        });
      } else {
        await exerciseServerSurface(production, entry, {
          label: "Next.js 15 Edge middleware",
          path: "/volato-middleware-crash",
          message: "Volato Next.js 15 middleware conformance",
          runtime: "middleware",
          capturedVia: "wrap_middleware",
          allowedSecondaryMessages: [
            "Cannot append headers after they are sent to the client",
          ],
          source: {
            path: `${instrumentationRelativeRoot ? `${instrumentationRelativeRoot}/` : ""}middleware.${runtimeExtension}`,
            marker:
              'throw new Error("Volato Next.js 15 middleware conformance")',
          },
        });
      }
      const expectedSourceChecks =
        (entry.router === "pages" ? 0 : 6) +
        (entry.router === "app" ? 0 : 4) +
        1;
      assert(
        state.sourceChecks - beforeSourceChecks === expectedSourceChecks,
        `${entry.label} verified ${
          state.sourceChecks - beforeSourceChecks
        } source pointers instead of ${expectedSourceChecks}.`,
      );
      assert(
        state.mappedSourceChecks > beforeMappedSourceChecks,
        `${entry.label} did not resolve any production frame through an uploaded sourcemap.`,
      );
    } finally {
      await stopNextProduction(production.child);
    }
    if (!staticLifecycleChecked && entry.router !== "app") {
      const beforeStaticEvents = state.testEvents.length;
      const failedStaticBuild = await run("pnpm", ["build"], {
        cwd: fixture,
        env: { VOLATO_CONFORMANCE_STATIC_FAILURE: "1" },
        allowFailure: true,
      });
      const staticOutput = `${failedStaticBuild.stdout}${failedStaticBuild.stderr}`;
      assert(
        failedStaticBuild.status !== 0 &&
          staticOutput.includes("Volato Pages getStaticProps build conformance"),
        `${entry.label} did not fail loudly for a getStaticProps build error.\n${staticOutput}`,
      );
      await new Promise((resolveWait) => setTimeout(resolveWait, 250));
      assert(
        state.testEvents.length === beforeStaticEvents,
        `${entry.label} misrepresented a build-time getStaticProps failure as a production event.`,
      );
      staticLifecycleChecked = true;
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
