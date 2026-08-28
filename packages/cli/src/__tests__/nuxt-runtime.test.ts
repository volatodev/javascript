import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const runtimeRoot = join(
  __dirname,
  "..",
  "..",
  "skills",
  "volato-nuxt",
  "assets",
  "runtime",
);
const browserSource = join(
  __dirname,
  "..",
  "..",
  "skills",
  "_shared",
  "errors-browser",
  "browser.ts",
);
const nodeSource = join(
  __dirname,
  "..",
  "..",
  "skills",
  "volato-node",
  "assets",
  "runtime",
  "node.ts",
);

let cwd: string;

async function bundle(
  entryName: "nuxt-client.ts" | "nitro.ts",
  injected: Record<string, string>,
): Promise<string> {
  const root = join(cwd, "runtime");
  mkdirSync(root, { recursive: true });
  writeFileSync(
    join(root, entryName),
    readFileSync(join(runtimeRoot, entryName), "utf8"),
  );
  writeFileSync(
    join(root, entryName === "nuxt-client.ts" ? "browser.ts" : "node.ts"),
    readFileSync(entryName === "nuxt-client.ts" ? browserSource : nodeSource, "utf8"),
  );
  const outfile = join(cwd, `${entryName}.mjs`);
  await build({
    entryPoints: [join(root, entryName)],
    outfile,
    bundle: true,
    format: "esm",
    platform: entryName === "nuxt-client.ts" ? "browser" : "node",
    target: "es2022",
    define: injected,
  });
  return outfile;
}

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), "volato-nuxt-runtime-"));
  vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 202 })));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete process.env.VOLATO_DSN;
  rmSync(cwd, { recursive: true, force: true });
});

describe("Nuxt client capture", () => {
  it("deduplicates overlapping hooks and keeps handled app errors silent", async () => {
    const listeners = new Map<string, EventListener>();
    vi.stubGlobal("window", {
      addEventListener: (name: string, listener: EventListener) =>
        listeners.set(name, listener),
      removeEventListener: (name: string) => listeners.delete(name),
    });
    vi.stubGlobal("location", { pathname: "/accounts/private-account" });
    vi.stubGlobal("navigator", { userAgent: "nuxt-canary" });
    const outfile = await bundle("nuxt-client.ts", {
      __VOLATO_BROWSER_CONFIG__: JSON.stringify({
        dsn: "https://public@api.volato.dev/project",
        environment: "production",
        release: "nuxt-browser-release",
      }),
    });
    const runtime = await import(`${pathToFileURL(outfile).href}?client`);
    runtime.installVolatoNuxtClient();
    const failure = new Error("client render failed") as Error & {
      component?: unknown;
    };
    failure.component = { email: "private@example.com" };

    runtime.captureVolatoNuxtVueError(failure);
    runtime.captureVolatoNuxtAppError(failure);
    runtime.captureVolatoNuxtAppError({
      message: "deliberate error page",
      fatal: false,
      unhandled: false,
      payload: "private-payload",
    });
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));

    const payload = JSON.parse(
      String((vi.mocked(fetch).mock.calls[0]?.[1] as RequestInit).body),
    );
    expect(payload).toMatchObject({
      runtime: "browser",
      capturedVia: "nuxt_app_error",
      route: "/:segment/:segment",
      release: "nuxt-browser-release",
    });
    expect(JSON.stringify(payload)).not.toMatch(
      /private-account|private@example|private-payload/,
    );
    expect(listeners.has("error")).toBe(true);
    expect(listeners.has("unhandledrejection")).toBe(true);
  });
});

describe("Nitro capture", () => {
  it("captures the original cause with bounded HTTP context and preserves hooks", async () => {
    process.env.VOLATO_DSN = "https://public@api.volato.dev/project";
    const outfile = await bundle("nitro.ts", {
      __VOLATO_SERVER_RELEASE__: JSON.stringify("nuxt-server-release"),
    });
    const runtime = await import(`${pathToFileURL(outfile).href}?nitro`);
    let hook:
      | ((error: Error & Record<string, unknown>, context: Record<string, unknown>) => Promise<void>)
      | undefined;
    const existing = vi.fn();
    const nitroApp = {
      hooks: {
        hook: vi.fn((name: string, callback: typeof hook) => {
          expect(name).toBe("error");
          hook = callback;
        }),
      },
      existing,
    };
    runtime.installVolatoNitro(nitroApp);
    expect(nitroApp.existing).toBe(existing);
    expect(hook).toBeTypeOf("function");

    const cause = new Error("SSR render failed") as Error & {
      customer?: unknown;
    };
    cause.customer = { email: "private@example.com" };
    const wrapper = Object.assign(new Error("wrapped"), {
      cause,
      unhandled: false,
      statusCode: 503,
    });
    const event = {
      method: "post",
      path: "/accounts/private-account?token=query-secret",
      context: {
        matchedRoute: { path: "/accounts/:accountId" },
        requestId: "request-safe",
        payload: "private-context",
      },
      headers: {
        get: (name: string) =>
          name === "x-request-id" ? "header-request-id" : "private-header",
      },
      body: { token: "body-secret" },
    };
    await hook!(wrapper, { event });
    await hook!(wrapper, { event });
    await hook!(
      Object.assign(new Error("deliberate"), {
        unhandled: false,
        statusCode: 404,
      }),
      { event },
    );

    expect(fetch).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(
      String((vi.mocked(fetch).mock.calls[0]?.[1] as RequestInit).body),
    );
    expect(payload).toMatchObject({
      message: "SSR render failed",
      runtime: "node",
      capturedVia: "nitro_error",
      method: "POST",
      route: "/accounts/:accountId",
      status: 503,
      requestId: "request-safe",
      release: "nuxt-server-release",
    });
    expect(JSON.stringify(payload)).not.toMatch(
      /private-account|query-secret|private-context|private-header|body-secret|private@example/,
    );
  });

  it("captures a startup error without installing process fatal handlers", async () => {
    process.env.VOLATO_DSN = "https://public@api.volato.dev/project";
    const before = {
      uncaught: process.listenerCount("uncaughtException"),
      rejection: process.listenerCount("unhandledRejection"),
    };
    const outfile = await bundle("nitro.ts", {
      __VOLATO_SERVER_RELEASE__: JSON.stringify("nuxt-startup-release"),
    });
    const runtime = await import(`${pathToFileURL(outfile).href}?startup`);
    let hook: ((error: Error, context: { event?: unknown }) => Promise<void>) | undefined;
    runtime.installVolatoNitro({
      hooks: { hook: (_name: string, callback: typeof hook) => (hook = callback) },
    });
    await hook!(new Error("startup failed"), {});

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(process.listenerCount("uncaughtException")).toBe(before.uncaught);
    expect(process.listenerCount("unhandledRejection")).toBe(before.rejection);
  });
});
