import { spawn, type ChildProcessByStdio } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  rmSync,
  rmdirSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { dirname, join, relative } from "node:path";
import type { Readable } from "node:stream";
import type { AppRouterLocation } from "./detect";

export type VerifyGeneratedNextjsOptions = {
  cwd: string;
  appDir: AppRouterLocation;
  runtimeRoot: string;
  dsn: string;
  timeoutMs?: number;
};

type VerificationResponse = {
  marker?: string;
  accepted?: boolean;
  stack?: boolean;
  detail?: string;
};

type VerificationChild = ChildProcessByStdio<null, Readable, Readable>;

function localModule(fromFile: string, target: string): string {
  let path = relative(dirname(fromFile), target).replaceAll("\\", "/");
  if (!path.startsWith(".")) path = `./${path}`;
  return path;
}

export function verificationRouteSource(
  serverModule: string,
  marker: string,
): string {
  return `import { __captureExceptionWithDelivery, initServer } from ${JSON.stringify(serverModule)};

const marker = ${JSON.stringify(marker)};
initServer({ enabled: true, environment: "development" });

export async function GET() {
  const error = new Error("Volato integration test — generated Next.js runtime");
  const accepted = await __captureExceptionWithDelivery(error, {
    runtime: "route_handler",
    route: "/__volato_verify__",
    capturedVia: "manual",
  });
  const detail = accepted
    ? "ingest accepted the generated capture"
    : "ingest did not accept the generated capture";

  return Response.json(
    { marker, accepted, stack: Boolean(error.stack), detail },
    { status: accepted ? 200 : 502 },
  );
}
`;
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Could not allocate a local verification port."));
        return;
      }
      server.close((error) => {
        if (error) reject(error);
        else resolve(address.port);
      });
    });
  });
}

function signalChild(
  child: VerificationChild,
  signal: NodeJS.Signals,
): void {
  if (child.exitCode !== null || child.signalCode !== null) return;
  try {
    if (process.platform !== "win32" && child.pid) {
      process.kill(-child.pid, signal);
    } else {
      child.kill(signal);
    }
  } catch {
    child.kill(signal);
  }
}

async function stopChild(child: VerificationChild): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const close = new Promise<true>((resolve) =>
    child.once("close", () => resolve(true)),
  );
  signalChild(child, "SIGTERM");
  const exited = await Promise.race([
    close,
    new Promise<false>((resolve) =>
      setTimeout(() => resolve(false), 5_000).unref(),
    ),
  ]);
  if (!exited) {
    if (child.exitCode !== null || child.signalCode !== null) return;
    signalChild(child, "SIGKILL");
    await close;
  }
}

async function waitForVerification(
  endpoint: string,
  marker: string,
  child: VerificationChild,
  output: () => string,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastDetail = "Next.js did not answer yet";

  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      const logs = output().trim();
      throw new Error(
        `Next.js exited before verification completed.${logs ? `\n${logs}` : ""}`,
      );
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2_000);
    try {
      const response = await fetch(endpoint, { signal: controller.signal });
      const body = (await response.json()) as VerificationResponse;
      if (body.marker === marker) {
        if (!response.ok || !body.accepted) {
          throw new Error(
            body.detail ?? `verification returned ${response.status}`,
          );
        }
        if (!body.stack) {
          throw new Error("the generated capture produced no Error stack");
        }
        return;
      }
      lastDetail = `unexpected response from local Next.js (${response.status})`;
    } catch (error) {
      if (
        error instanceof Error &&
        (error.message.startsWith("ingest ") ||
          error.message.includes("generated capture"))
      ) {
        throw error;
      }
      lastDetail = error instanceof Error ? error.message : String(error);
    } finally {
      clearTimeout(timer);
    }

    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  const logs = output().trim();
  throw new Error(
    `Timed out waiting for the generated Next.js integration (${lastDetail}).${logs ? `\n${logs}` : ""}`,
  );
}

/**
 * Exercise the generated integration through a real local Route Handler.
 *
 * The route is unique and temporary, imports the generated server runtime,
 * captures a real Error, and observes the actual ingest response. The helper
 * removes the route and stops its isolated Next.js process on success, error,
 * timeout, SIGINT, or SIGTERM.
 */
export async function verifyGeneratedNextjsIntegration(
  options: VerifyGeneratedNextjsOptions,
): Promise<void> {
  const apiDir = join(options.cwd, options.appDir, "api");
  const apiDirExisted = existsSync(apiDir);
  mkdirSync(apiDir, { recursive: true });

  let routeDir: string;
  do {
    routeDir = join(
      apiDir,
      `volato-verify-${randomUUID().replaceAll("-", "")}`,
    );
  } while (existsSync(routeDir));
  mkdirSync(routeDir);

  const routePath = join(routeDir, "route.ts");
  const marker = randomUUID();
  const routeName = relative(join(options.cwd, options.appDir), routeDir)
    .replaceAll("\\", "/")
    .replace(/^api\//, "api/");
  writeFileSync(
    routePath,
    verificationRouteSource(
      localModule(routePath, join(options.runtimeRoot, "server")),
      marker,
    ),
    { encoding: "utf8", flag: "wx" },
  );

  let child: VerificationChild | null = null;
  const cleanupFiles = () => {
    rmSync(routeDir, { recursive: true, force: true });
    if (!apiDirExisted) {
      try {
        rmdirSync(apiDir);
      } catch {
        // Another file appeared while Next.js was running; never remove it.
      }
    }
  };
  const cleanupOnSignal = (signal: NodeJS.Signals) => {
    if (child) signalChild(child, "SIGTERM");
    cleanupFiles();
    process.off("SIGINT", onSigint);
    process.off("SIGTERM", onSigterm);
    process.kill(process.pid, signal);
  };
  const onSigint = () => cleanupOnSignal("SIGINT");
  const onSigterm = () => cleanupOnSignal("SIGTERM");
  process.once("SIGINT", onSigint);
  process.once("SIGTERM", onSigterm);

  try {
    const nextBin = join(
      options.cwd,
      "node_modules",
      "next",
      "dist",
      "bin",
      "next",
    );
    if (!existsSync(nextBin)) {
      throw new Error(
        "Next.js is not installed locally. Install project dependencies, then rerun `volato errors init --send-test-event`.",
      );
    }

    const port = await freePort();
    const startedChild = spawn(
      process.execPath,
      [
        nextBin,
        "dev",
        "--hostname",
        "127.0.0.1",
        "--port",
        String(port),
      ],
      {
        cwd: options.cwd,
        detached: process.platform !== "win32",
        env: {
          ...process.env,
          NEXT_PUBLIC_VOLATO_DSN: options.dsn,
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    child = startedChild;

    let logs = "";
    const appendLog = (chunk: Buffer) => {
      logs = `${logs}${chunk.toString("utf8")}`.slice(-32_000);
    };
    startedChild.stdout.on("data", appendLog);
    startedChild.stderr.on("data", appendLog);

    await waitForVerification(
      `http://127.0.0.1:${port}/${routeName}`,
      marker,
      startedChild,
      () => logs,
      options.timeoutMs ?? 60_000,
    );
  } finally {
    process.off("SIGINT", onSigint);
    process.off("SIGTERM", onSigterm);
    if (child) await stopChild(child);
    cleanupFiles();
  }
}
