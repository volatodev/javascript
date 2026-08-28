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
import { build, type Plugin } from "esbuild";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BROWSER_JAVASCRIPT_RUNTIME } from "../generated/browser-javascript-runtime";
import { NODE_JAVASCRIPT_RUNTIME } from "../generated/node-javascript-runtime";

const runtimeRoot = join(
  __dirname,
  "..",
  "..",
  "skills",
  "volato-astro",
  "assets",
  "runtime",
);
let cwd: string;

function astroMiddlewareStub(): Plugin {
  return {
    name: "astro-middleware-stub",
    setup(pluginBuild) {
      pluginBuild.onResolve({ filter: /^astro:middleware$/ }, () => ({
        path: "astro:middleware",
        namespace: "volato-test",
      }));
      pluginBuild.onLoad(
        { filter: /.*/, namespace: "volato-test" },
        () => ({ contents: "export const defineMiddleware = (handler) => handler;", loader: "js" }),
      );
    },
  };
}

async function bundle(
  entryName: "client.mjs" | "middleware.mjs" | "vue-app.mjs",
  platform: "browser" | "node",
  define: Record<string, string>,
): Promise<{ outfile: string; code: string }> {
  const root = join(cwd, "runtime");
  mkdirSync(root, { recursive: true });
  for (const name of [
    entryName,
    "vue-client.mjs",
  ]) {
    const source = join(runtimeRoot, name);
    try {
      writeFileSync(join(root, name), readFileSync(source, "utf8"));
    } catch {
      // Only the Vue entry needs its lazily imported browser branch.
    }
  }
  writeFileSync(join(root, "browser.mjs"), BROWSER_JAVASCRIPT_RUNTIME["browser.js"]);
  writeFileSync(join(root, "node.mjs"), NODE_JAVASCRIPT_RUNTIME["node.js"]);
  const outfile = join(cwd, `${entryName}-${platform}.mjs`);
  await build({
    entryPoints: [join(root, entryName)],
    outfile,
    bundle: true,
    format: "esm",
    platform,
    target: "es2022",
    define,
    plugins: [astroMiddlewareStub()],
  });
  return { outfile, code: readFileSync(outfile, "utf8") };
}

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), "volato-astro-runtime-"));
  vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 202 })));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete process.env.VOLATO_DSN;
  rmSync(cwd, { recursive: true, force: true });
});

describe("Astro browser ownership", () => {
  it("captures the exact hydration error once without consuming Astro's event", async () => {
    const windowListeners = new Map<string, EventListener>();
    const documentListeners = new Map<string, EventListener>();
    vi.stubGlobal("window", {
      addEventListener: (name: string, listener: EventListener) =>
        windowListeners.set(name, listener),
      removeEventListener: (name: string) => windowListeners.delete(name),
    });
    vi.stubGlobal("document", {
      addEventListener: (name: string, listener: EventListener) =>
        documentListeners.set(name, listener),
    });
    vi.stubGlobal("location", { pathname: "/accounts/private-account" });
    vi.stubGlobal("navigator", { userAgent: "astro-canary" });
    const { outfile } = await bundle("client.mjs", "browser", {
      __VOLATO_BROWSER_CONFIG__: JSON.stringify({
        dsn: "https://public@api.volato.dev/project",
        environment: "production",
        release: "astro-browser-release",
      }),
    });
    await import(`${pathToFileURL(outfile).href}?client`);
    const failure = Object.assign(new Error("Svelte hydration failed"), {
      islandProps: { email: "private@example.com" },
    });
    const event = {
      detail: {
        error: failure,
        componentUrl: "/private/Widget.svelte",
        props: { token: "secret" },
      },
      defaultPrevented: false,
    } as unknown as Event;

    documentListeners.get("astro:hydration-error")?.(event);
    windowListeners.get("error")?.({ error: failure } as ErrorEvent);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));

    const payload = JSON.parse(
      String((vi.mocked(fetch).mock.calls[0]?.[1] as RequestInit).body),
    );
    expect(payload).toMatchObject({
      message: "Svelte hydration failed",
      runtime: "browser",
      capturedVia: "astro_hydration_error",
      route: "/:segment/:segment",
      release: "astro-browser-release",
    });
    expect(JSON.stringify(payload)).not.toMatch(
      /private-account|private@example|Widget\.svelte|secret/,
    );
    expect(event.defaultPrevented).toBe(false);
  });

  it("keeps the Vue browser bundle free of Node runtime and preserves fallback logging", async () => {
    const listeners = new Map<string, EventListener>();
    vi.stubGlobal("window", {
      addEventListener: (name: string, listener: EventListener) => listeners.set(name, listener),
      removeEventListener: vi.fn(),
    });
    vi.stubGlobal("location", { pathname: "/vue" });
    vi.stubGlobal("navigator", { userAgent: "astro-vue-canary" });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { outfile, code } = await bundle("vue-app.mjs", "browser", {
      "import.meta.env.SSR": "false",
      __VOLATO_BROWSER_CONFIG__: JSON.stringify({
        dsn: "https://public@api.volato.dev/project",
        environment: "production",
        release: "astro-vue-release",
      }),
      __VOLATO_SERVER_RELEASE__: "undefined",
    });
    expect(code).not.toMatch(/node:|process\.env\.VOLATO_DSN|uncaughtException/);
    const runtime = await import(`${pathToFileURL(outfile).href}?vue`);
    const app = { config: { errorHandler: undefined as undefined | ((...args: unknown[]) => unknown) } };
    runtime.default(app);
    const failure = new Error("Vue hydration failed");

    app.config.errorHandler!(failure, { private: true }, "private info");
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));

    expect(errorSpy).toHaveBeenCalledWith(failure);
    const payload = JSON.parse(
      String((vi.mocked(fetch).mock.calls[0]?.[1] as RequestInit).body),
    );
    expect(payload.capturedVia).toBe("vue_error_handler");
    expect(JSON.stringify(payload)).not.toMatch(/private info/);
  });
});

describe("Astro standalone Node middleware", () => {
  it("captures bounded context, installs no fatal handlers and rethrows the same error", async () => {
    process.env.VOLATO_DSN = "https://public@api.volato.dev/project";
    const before = {
      uncaught: process.listenerCount("uncaughtException"),
      rejection: process.listenerCount("unhandledRejection"),
    };
    const { outfile } = await bundle("middleware.mjs", "node", {
      __VOLATO_SERVER_RELEASE__: JSON.stringify("astro-server-release"),
    });
    const runtime = await import(`${pathToFileURL(outfile).href}?middleware`);
    const failure = Object.assign(new Error("Astro render failed"), {
      customer: "private@example.com",
    });
    const context = {
      routePattern: "/accounts/[accountId]",
      url: new URL("https://example.test/accounts/private-account?token=secret"),
      params: { accountId: "private-account" },
      locals: { user: "private@example.com" },
      request: {
        method: "post",
        headers: { get: (name: string) => (name === "x-request-id" ? "request-safe" : "private") },
        body: "body-secret",
      },
    };

    await expect(runtime.onRequest(context, async () => {
      throw failure;
    })).rejects.toBe(failure);

    expect(fetch).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(
      String((vi.mocked(fetch).mock.calls[0]?.[1] as RequestInit).body),
    );
    expect(payload).toMatchObject({
      message: "Astro render failed",
      runtime: "node",
      capturedVia: "astro_middleware",
      method: "POST",
      route: "/accounts/[accountId]",
      status: 500,
      requestId: "request-safe",
      release: "astro-server-release",
    });
    expect(JSON.stringify(payload)).not.toMatch(
      /private-account|token=secret|body-secret|private@example/,
    );
    expect(process.listenerCount("uncaughtException")).toBe(before.uncaught);
    expect(process.listenerCount("unhandledRejection")).toBe(before.rejection);
  });

  it("does not inspect or replace a successful streamed response", async () => {
    const { outfile } = await bundle("middleware.mjs", "node", {
      __VOLATO_SERVER_RELEASE__: "undefined",
    });
    const runtime = await import(`${pathToFileURL(outfile).href}?success`);
    const response = new Response("stream", { status: 200, headers: { "x-app": "kept" } });

    await expect(
      runtime.onRequest(
        { request: { method: "GET", headers: new Headers() }, routePattern: "/stream" },
        async () => response,
      ),
    ).resolves.toBe(response);
    expect(fetch).not.toHaveBeenCalled();
    expect(response.headers.get("x-app")).toBe("kept");
  });
});
