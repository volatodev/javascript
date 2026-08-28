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
  "volato-sveltekit",
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
  entryName: "client.ts" | "server.ts",
  injected: Record<string, string>,
): Promise<string> {
  const root = join(cwd, "runtime");
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, entryName), readFileSync(join(runtimeRoot, entryName), "utf8"));
  writeFileSync(
    join(root, entryName === "client.ts" ? "browser.ts" : "node.ts"),
    readFileSync(entryName === "client.ts" ? browserSource : nodeSource, "utf8"),
  );
  const outfile = join(cwd, `${entryName}.mjs`);
  await build({
    entryPoints: [join(root, entryName)],
    outfile,
    bundle: true,
    format: "esm",
    platform: entryName === "client.ts" ? "browser" : "node",
    target: "es2022",
    define: injected,
  });
  return outfile;
}

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), "volato-sveltekit-runtime-"));
  vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 202 })));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete process.env.VOLATO_DSN;
  rmSync(cwd, { recursive: true, force: true });
});

describe("SvelteKit client handleError capture", () => {
  it("captures once, ignores hook context and preserves receiver, argument and result", async () => {
    const listeners = new Map<string, EventListener>();
    vi.stubGlobal("window", {
      addEventListener: (name: string, listener: EventListener) => listeners.set(name, listener),
      removeEventListener: (name: string) => listeners.delete(name),
    });
    vi.stubGlobal("location", { pathname: "/accounts/private-account" });
    vi.stubGlobal("navigator", { userAgent: "sveltekit-canary" });
    const outfile = await bundle("client.ts", {
      __VOLATO_BROWSER_CONFIG__: JSON.stringify({
        dsn: "https://public@api.volato.dev/project",
        environment: "production",
        release: "sveltekit-browser-release",
      }),
    });
    const runtime = await import(`${pathToFileURL(outfile).href}?client`);
    const result = { message: "safe", code: "CLIENT" };
    const receiver = { marker: "receiver" };
    const application = vi.fn(function (this: unknown, input: unknown) {
      expect(this).toBe(receiver);
      expect(input).toBe(argument);
      return result;
    });
    const wrapper = runtime.createVolatoSvelteKitClientHandleError(application);
    const failure = Object.assign(new Error("client load failed"), {
      privateState: "private-component-state",
    });
    const argument = {
      error: failure,
      message: "safe framework message",
      status: 500,
      event: { url: "https://example.test/private?token=secret", params: { id: "private" } },
    };

    expect(wrapper.call(receiver, argument)).toBe(result);
    listeners.get("error")?.({ error: failure } as ErrorEvent);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));

    const payload = JSON.parse(
      String((vi.mocked(fetch).mock.calls[0]?.[1] as RequestInit).body),
    );
    expect(payload).toMatchObject({
      message: "client load failed",
      runtime: "browser",
      capturedVia: "sveltekit_client_handle_error",
      route: "/:segment/:segment",
      release: "sveltekit-browser-release",
    });
    expect(JSON.stringify(payload)).not.toMatch(
      /private-account|private-component-state|token=secret|safe framework message/,
    );
    expect(application).toHaveBeenCalledTimes(1);
  });

  it("preserves the default safe error result without an application hook", async () => {
    vi.stubGlobal("window", { addEventListener: vi.fn(), removeEventListener: vi.fn() });
    vi.stubGlobal("location", { pathname: "/" });
    const outfile = await bundle("client.ts", {
      __VOLATO_BROWSER_CONFIG__: JSON.stringify({ enabled: false }),
    });
    const runtime = await import(`${pathToFileURL(outfile).href}?default`);

    expect(
      runtime.createVolatoSvelteKitClientHandleError()({
        error: new Error("unexpected"),
        message: "Internal Error",
      }),
    ).toEqual({ message: "Internal Error" });
  });
});

describe("SvelteKit server handleError capture", () => {
  it("captures bounded route context and preserves a Promise result exactly", async () => {
    process.env.VOLATO_DSN = "https://public@api.volato.dev/project";
    const before = {
      uncaught: process.listenerCount("uncaughtException"),
      rejection: process.listenerCount("unhandledRejection"),
    };
    const outfile = await bundle("server.ts", {
      __VOLATO_SERVER_RELEASE__: JSON.stringify("sveltekit-server-release"),
    });
    const runtime = await import(`${pathToFileURL(outfile).href}?server`);
    const result = Promise.resolve({ message: "safe", code: "SERVER" });
    const receiver = { marker: "receiver" };
    const application = vi.fn(function (this: unknown, input: unknown) {
      expect(this).toBe(receiver);
      expect(input).toBe(argument);
      return result;
    });
    const wrapper = runtime.createVolatoSvelteKitServerHandleError(application);
    const failure = Object.assign(new Error("server load failed"), {
      customer: "private@example.com",
    });
    const argument = {
      error: failure,
      message: "Internal Error",
      status: 503,
      event: {
        request: {
          method: "post",
          headers: { get: (name: string) => (name === "x-request-id" ? "request-safe" : "private") },
          body: "body-secret",
        },
        route: { id: "/accounts/[accountId]" },
        url: new URL("https://example.test/accounts/private-account?token=query-secret"),
        params: { accountId: "private-account" },
        locals: { user: "private@example.com" },
      },
    };

    expect(wrapper.call(receiver, argument)).toBe(result);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));

    const payload = JSON.parse(
      String((vi.mocked(fetch).mock.calls[0]?.[1] as RequestInit).body),
    );
    expect(payload).toMatchObject({
      message: "server load failed",
      runtime: "node",
      capturedVia: "sveltekit_server_handle_error",
      method: "POST",
      route: "/accounts/[accountId]",
      status: 503,
      requestId: "request-safe",
      release: "sveltekit-server-release",
    });
    expect(JSON.stringify(payload)).not.toMatch(
      /private-account|query-secret|body-secret|private@example|Internal Error/,
    );
    expect(application).toHaveBeenCalledTimes(1);
    expect(process.listenerCount("uncaughtException")).toBe(before.uncaught);
    expect(process.listenerCount("unhandledRejection")).toBe(before.rejection);
  });

  it("does not hide an application hook throw", async () => {
    const outfile = await bundle("server.ts", {
      __VOLATO_SERVER_RELEASE__: "undefined",
    });
    const runtime = await import(`${pathToFileURL(outfile).href}?throw`);
    const applicationFailure = new Error("application hook failed");
    const wrapper = runtime.createVolatoSvelteKitServerHandleError(() => {
      throw applicationFailure;
    });

    expect(() =>
      wrapper({ error: new Error("original"), message: "safe", status: 500 }),
    ).toThrow(applicationFailure);
  });
});
