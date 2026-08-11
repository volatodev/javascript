/**
 * Upload-path tests for `withVolato()`'s webpack plugin.
 *
 * The plugin was shipping with a silent-catch bug (commit before this
 * one) that swallowed every 401 from the ingest, so users with
 * `withVolato()` in `next.config.ts` got zero sourcemaps uploaded
 * without any signal. These tests pin the contract end-to-end:
 *
 *   - Bearer auth (DSN must not be used as the upload credential).
 *   - Multipart body matching the ingest's expectations.
 *   - `sourcesContent` is stripped before transit (privacy posture).
 *   - Failures fire a loud warning — never a silent drop.
 *   - Transient errors retry; 4xx surfaces immediately.
 */

import { mkdtempSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  __VolatoSourceMapsPlugin,
  __uploadOneForTests,
} from "../withVolato";
import { __resetReleaseCacheForTests } from "../internal/release";

// Suite-wide env so the load-time warning in withVolato() (covered by
// withVolato.test.ts) doesn't leak stderr noise into these cases.
const ORIGINAL_TOKEN = process.env.VOLATO_INGEST_TOKEN;
const ORIGINAL_DSN = process.env.NEXT_PUBLIC_VOLATO_DSN;
const ORIGINAL_RELEASE = process.env.VOLATO_RELEASE;

beforeAll(() => {
  process.env.VOLATO_INGEST_TOKEN = "suite-token";
});
afterAll(() => {
  const restore = (k: string, v: string | undefined) => {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  };
  restore("VOLATO_INGEST_TOKEN", ORIGINAL_TOKEN);
  restore("NEXT_PUBLIC_VOLATO_DSN", ORIGINAL_DSN);
  restore("VOLATO_RELEASE", ORIGINAL_RELEASE);
});

// A representative `.map` file as Next.js would emit one. Includes a
// `sourcesContent` field that MUST be stripped before transit.
const SAMPLE_MAP = JSON.stringify({
  version: 3,
  sources: ["webpack:///./app/page.tsx"],
  names: ["foo", "bar"],
  mappings: "AAAA;AACA;",
  sourcesContent: ["export default function Page() { return 'secret' }"],
});

describe("__uploadOneForTests — happy path", () => {
  it("POSTs Bearer + multipart, returns 'uploaded' on 201", async () => {
    const dir = mkdtempSync(join(tmpdir(), "volato-upload-"));
    const mapPath = join(dir, "page-abc12345.js.map");
    writeFileSync(mapPath, SAMPLE_MAP);

    const calls: { url: string; init: RequestInit }[] = [];
    const fetchImpl = vi.fn(async (input: URL | string, init?: RequestInit) => {
      calls.push({ url: String(input), init: init ?? {} });
      return new Response(null, { status: 201 });
    }) as unknown as typeof fetch;

    const warn = vi.fn();
    const outcome = await __uploadOneForTests({
      mapPath,
      jsRelative: ".next/static/chunks/page-abc12345.js",
      release: "sha-deadbeef",
      endpoint: "https://api.volato.dev",
      token: "the-token",
      fetchImpl,
      warn,
    });

    expect(outcome).toBe("uploaded");
    expect(warn).not.toHaveBeenCalled();
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://api.volato.dev/api/sourcemaps");

    const headers = calls[0]?.init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer the-token");
    // No `X-Volato-DSN` — the ingest rejects DSN-bearing writes.
    expect(headers["X-Volato-DSN"]).toBeUndefined();

    const body = calls[0]?.init.body as FormData;
    expect(body).toBeInstanceOf(FormData);
    expect(body.get("release")).toBe("sha-deadbeef");
    expect(body.get("filename_hash")).toBe("abc12345");
    expect(body.get("display_path")).toBe("static/chunks/page-abc12345.js");

    const mapBlob = body.get("map") as Blob;
    expect(mapBlob).toBeInstanceOf(Blob);
    const mapText = await mapBlob.text();
    const parsed = JSON.parse(mapText);
    // The privacy load-bearer: sourcesContent must be gone.
    expect(parsed).not.toHaveProperty("sourcesContent");
    expect(parsed.sources).toEqual(["webpack:///./app/page.tsx"]);
    expect(parsed.mappings).toBe("AAAA;AACA;");
  });

  it("returns 'updated' on 200", async () => {
    const dir = mkdtempSync(join(tmpdir(), "volato-upload-"));
    const mapPath = join(dir, "page-abc12345.js.map");
    writeFileSync(mapPath, SAMPLE_MAP);

    const fetchImpl = vi.fn(async () => new Response(null, { status: 200 })) as unknown as typeof fetch;
    const warn = vi.fn();
    const outcome = await __uploadOneForTests({
      mapPath,
      jsRelative: ".next/static/chunks/page-abc12345.js",
      release: "sha",
      endpoint: "https://api.volato.dev",
      token: "t",
      fetchImpl,
      warn,
    });
    expect(outcome).toBe("updated");
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("__uploadOneForTests — error surfaces (never silent)", () => {
  function setupMap(): string {
    const dir = mkdtempSync(join(tmpdir(), "volato-upload-"));
    const mapPath = join(dir, "page-abc12345.js.map");
    writeFileSync(mapPath, SAMPLE_MAP);
    return mapPath;
  }

  it("401 → 'failed' + loud warning naming VOLATO_INGEST_TOKEN, no retry", async () => {
    const fetchImpl = vi.fn(async () => new Response("forbidden", { status: 401 })) as unknown as typeof fetch;
    const warn = vi.fn();
    const outcome = await __uploadOneForTests({
      mapPath: setupMap(),
      jsRelative: ".next/static/chunks/page-abc12345.js",
      release: "sha",
      endpoint: "https://api.volato.dev",
      token: "wrong",
      fetchImpl,
      warn,
    });
    expect(outcome).toBe("failed");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toMatch(/VOLATO_INGEST_TOKEN/);
    expect(warn.mock.calls[0]?.[0]).toMatch(/rejected/i);
  });

  it("network error retries 3x with backoff then loud warning", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    const warn = vi.fn();
    const outcome = await __uploadOneForTests({
      mapPath: setupMap(),
      jsRelative: ".next/static/chunks/page-abc12345.js",
      release: "sha",
      endpoint: "https://api.volato.dev",
      token: "t",
      fetchImpl,
      warn,
    });
    expect(outcome).toBe("failed");
    expect(fetchImpl).toHaveBeenCalledTimes(4); // initial + 3 retries
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toMatch(/network/);
    expect(warn.mock.calls[0]?.[0]).toMatch(/4 attempts/);
  });

  it("5xx retries then loud warning", async () => {
    const fetchImpl = vi.fn(async () => new Response("oops", { status: 503 })) as unknown as typeof fetch;
    const warn = vi.fn();
    const outcome = await __uploadOneForTests({
      mapPath: setupMap(),
      jsRelative: ".next/static/chunks/page-abc12345.js",
      release: "sha",
      endpoint: "https://api.volato.dev",
      token: "t",
      fetchImpl,
      warn,
    });
    expect(outcome).toBe("failed");
    expect(fetchImpl).toHaveBeenCalledTimes(4);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toMatch(/503/);
  });

  it("recovers after transient 5xx if a later attempt succeeds", async () => {
    let n = 0;
    const fetchImpl = vi.fn(async () => {
      n += 1;
      if (n < 3) return new Response(null, { status: 502 });
      return new Response(null, { status: 201 });
    }) as unknown as typeof fetch;
    const warn = vi.fn();
    const outcome = await __uploadOneForTests({
      mapPath: setupMap(),
      jsRelative: ".next/static/chunks/page-abc12345.js",
      release: "sha",
      endpoint: "https://api.volato.dev",
      token: "t",
      fetchImpl,
      warn,
    });
    expect(outcome).toBe("uploaded");
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(warn).not.toHaveBeenCalled();
  });

  it("400 sources_content_forbidden surfaces immediately without retry", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ error: "sources_content_forbidden" }), { status: 400 }),
    ) as unknown as typeof fetch;
    const warn = vi.fn();
    const outcome = await __uploadOneForTests({
      mapPath: setupMap(),
      jsRelative: ".next/static/chunks/page-abc12345.js",
      release: "sha",
      endpoint: "https://api.volato.dev",
      token: "t",
      fetchImpl,
      warn,
    });
    expect(outcome).toBe("failed");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toMatch(/400/);
    expect(warn.mock.calls[0]?.[0]).toMatch(/sources_content_forbidden/);
  });

  it("413 payload_too_large surfaces immediately", async () => {
    const fetchImpl = vi.fn(async () => new Response("payload_too_large", { status: 413 })) as unknown as typeof fetch;
    const warn = vi.fn();
    const outcome = await __uploadOneForTests({
      mapPath: setupMap(),
      jsRelative: ".next/static/chunks/page-abc12345.js",
      release: "sha",
      endpoint: "https://api.volato.dev",
      token: "t",
      fetchImpl,
      warn,
    });
    expect(outcome).toBe("failed");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toMatch(/413/);
  });

  it("429 rate_limited does not retry (4xx)", async () => {
    const fetchImpl = vi.fn(async () => new Response("rate_limited", { status: 429 })) as unknown as typeof fetch;
    const warn = vi.fn();
    const outcome = await __uploadOneForTests({
      mapPath: setupMap(),
      jsRelative: ".next/static/chunks/page-abc12345.js",
      release: "sha",
      endpoint: "https://api.volato.dev",
      token: "t",
      fetchImpl,
      warn,
    });
    expect(outcome).toBe("failed");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

describe("__uploadOneForTests — skip cases", () => {
  it("uploads a deterministic Next.js server entry map without a chunk hash", async () => {
    const dir = mkdtempSync(join(tmpdir(), "volato-upload-"));
    const mapPath = join(dir, "route.js.map");
    writeFileSync(mapPath, SAMPLE_MAP);

    const fetchImpl = vi.fn(async () =>
      new Response(null, { status: 201 }),
    ) as unknown as typeof fetch;
    const warn = vi.fn();
    const outcome = await __uploadOneForTests({
      mapPath,
      jsRelative: ".next/server/app/api/crash/route.js",
      release: "sha",
      endpoint: "https://api.volato.dev",
      token: "t",
      fetchImpl,
      warn,
    });

    expect(outcome).toBe("uploaded");
    const request = fetchImpl.mock.calls[0]?.[1] as RequestInit;
    const form = request.body as FormData;
    expect(form.get("display_path")).toBe("server/app/api/crash/route.js");
    expect(form.get("filename_hash")).toMatch(/^p[a-f0-9]{15}$/);
    expect(warn).not.toHaveBeenCalled();
  });

  it("non-hashed filename → 'skipped' + warning, no fetch", async () => {
    const dir = mkdtempSync(join(tmpdir(), "volato-upload-"));
    const mapPath = join(dir, "no-hash.js.map");
    writeFileSync(mapPath, SAMPLE_MAP);

    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const warn = vi.fn();
    const outcome = await __uploadOneForTests({
      mapPath,
      jsRelative: ".next/static/chunks/no-hash.js",
      release: "sha",
      endpoint: "https://api.volato.dev",
      token: "t",
      fetchImpl,
      warn,
    });
    expect(outcome).toBe("skipped");
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toMatch(/no hashed filename/);
  });

  it("invalid JSON sourcemap → 'skipped' + warning, no fetch", async () => {
    const dir = mkdtempSync(join(tmpdir(), "volato-upload-"));
    const mapPath = join(dir, "page-abc12345.js.map");
    writeFileSync(mapPath, "not json {{");

    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const warn = vi.fn();
    const outcome = await __uploadOneForTests({
      mapPath,
      jsRelative: ".next/static/chunks/page-abc12345.js",
      release: "sha",
      endpoint: "https://api.volato.dev",
      token: "t",
      fetchImpl,
      warn,
    });
    expect(outcome).toBe("skipped");
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toMatch(/not valid JSON/);
  });
});

// ---------------------------------------------------------------------
// Plugin-level integration: drive `apply()` against a fake compiler so
// the env-var skipping paths are pinned. We don't care about the
// webpack lifecycle internals — just that the plugin honours the
// "no token → silent, otherwise no silent drops" contract.
// ---------------------------------------------------------------------

type FakeCompiler = {
  options: { output?: { path?: string } };
  hooks: {
    afterEmit: { tapPromise: (name: string, cb: () => Promise<void>) => void };
  };
};

function makeFakeCompiler(outputPath: string): {
  compiler: FakeCompiler;
  trigger: () => Promise<void>;
} {
  let registered: (() => Promise<void>) | undefined;
  const compiler: FakeCompiler = {
    options: { output: { path: outputPath } },
    hooks: {
      afterEmit: {
        tapPromise: (_name, cb) => {
          registered = cb;
        },
      },
    },
  };
  return {
    compiler,
    trigger: async () => {
      if (!registered) throw new Error("afterEmit was never registered");
      await registered();
    },
  };
}

function makeBuildDir(): { root: string; mapPath: string } {
  const root = mkdtempSync(join(tmpdir(), "volato-build-"));
  const chunks = join(root, "static", "chunks");
  mkdirSync(chunks, { recursive: true });
  const mapPath = join(chunks, "page-abc12345.js.map");
  writeFileSync(mapPath, SAMPLE_MAP);
  return { root, mapPath };
}

describe("__VolatoSourceMapsPlugin — env-var gating", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    process.env.VOLATO_INGEST_TOKEN = "suite-token";
    process.env.NEXT_PUBLIC_VOLATO_DSN = "https://abc@api.volato.dev/proj-1";
    process.env.VOLATO_RELEASE = "sha-1";
    // detectRelease() memoizes — without a reset, a prior test's
    // VOLATO_RELEASE value would leak across cases.
    __resetReleaseCacheForTests();
  });
  afterEach(() => {
    warnSpy.mockRestore();
  });

  it("uploads when token + DSN + release are all set", async () => {
    const { root, mapPath } = makeBuildDir();
    const fetchImpl = vi.fn(async () => new Response(null, { status: 201 })) as unknown as typeof fetch;

    const plugin = new __VolatoSourceMapsPlugin({ hideSourceMaps: false }, { fetchImpl, cwd: root });
    const { compiler, trigger } = makeFakeCompiler(root);
    plugin.apply(compiler);
    await trigger();

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    // Map file kept on disk because hideSourceMaps:false.
    expect(existsSync(mapPath)).toBe(true);
  });

  it("uploads an overlapping map once across Next webpack compilers", async () => {
    const { root } = makeBuildDir();
    const fetchImpl = vi.fn(async () => {
      await Promise.resolve();
      return new Response(null, { status: 201 });
    }) as unknown as typeof fetch;

    const first = new __VolatoSourceMapsPlugin(
      { hideSourceMaps: false },
      { fetchImpl, cwd: root },
    );
    const second = new __VolatoSourceMapsPlugin(
      { hideSourceMaps: false },
      { fetchImpl, cwd: root },
    );
    const firstCompiler = makeFakeCompiler(root);
    const secondCompiler = makeFakeCompiler(root);
    first.apply(firstCompiler.compiler);
    second.apply(secondCompiler.compiler);

    await Promise.all([firstCompiler.trigger(), secondCompiler.trigger()]);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("does not upload stale maps left by next dev", async () => {
    const { root } = makeBuildDir();
    const devChunks = join(root, "dev", "server", "chunks");
    mkdirSync(devChunks, { recursive: true });
    writeFileSync(join(devChunks, "stale-abc12345.js.map"), SAMPLE_MAP);
    const fetchImpl = vi.fn(async () =>
      new Response(null, { status: 201 }),
    ) as unknown as typeof fetch;

    const plugin = new __VolatoSourceMapsPlugin(
      { hideSourceMaps: false },
      { fetchImpl, cwd: root },
    );
    const { compiler, trigger } = makeFakeCompiler(root);
    plugin.apply(compiler);
    await trigger();

    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("deletes maps after upload when hideSourceMaps is on (default)", async () => {
    const { root, mapPath } = makeBuildDir();
    const fetchImpl = vi.fn(async () => new Response(null, { status: 201 })) as unknown as typeof fetch;

    const plugin = new __VolatoSourceMapsPlugin({}, { fetchImpl, cwd: root });
    const { compiler, trigger } = makeFakeCompiler(root);
    plugin.apply(compiler);
    await trigger();

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(existsSync(mapPath)).toBe(false);
  });

  it("keeps uploaded server maps for Next standalone assembly", async () => {
    const root = mkdtempSync(join(tmpdir(), "volato-build-"));
    const serverRoute = join(root, "server", "app", "api", "crash");
    mkdirSync(serverRoute, { recursive: true });
    const mapPath = join(serverRoute, "route.js.map");
    writeFileSync(mapPath, SAMPLE_MAP);
    const fetchImpl = vi.fn(async () =>
      new Response(null, { status: 201 }),
    ) as unknown as typeof fetch;

    const plugin = new __VolatoSourceMapsPlugin({}, { fetchImpl, cwd: root });
    const { compiler, trigger } = makeFakeCompiler(root);
    plugin.apply(compiler);
    await trigger();

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(existsSync(mapPath)).toBe(true);
  });

  it("keeps the .map on disk if the upload failed", async () => {
    const { root, mapPath } = makeBuildDir();
    const fetchImpl = vi.fn(async () => new Response("nope", { status: 401 })) as unknown as typeof fetch;

    const plugin = new __VolatoSourceMapsPlugin({}, { fetchImpl, cwd: root });
    const { compiler, trigger } = makeFakeCompiler(root);
    plugin.apply(compiler);
    await trigger();

    expect(existsSync(mapPath)).toBe(true);
  });

  it("missing token → no fetch, no double warning (top-level already warned)", async () => {
    delete process.env.VOLATO_INGEST_TOKEN;
    const { root } = makeBuildDir();
    const fetchImpl = vi.fn() as unknown as typeof fetch;

    const plugin = new __VolatoSourceMapsPlugin({}, { fetchImpl, cwd: root });
    const { compiler, trigger } = makeFakeCompiler(root);
    plugin.apply(compiler);
    await trigger();

    expect(fetchImpl).not.toHaveBeenCalled();
    // The load-time warning fires from withVolato() itself, not from
    // the afterEmit hook. The plugin stays silent here on purpose to
    // avoid doubling the warning on every build.
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("missing DSN → loud warning + no fetch", async () => {
    delete process.env.NEXT_PUBLIC_VOLATO_DSN;
    const { root } = makeBuildDir();
    const fetchImpl = vi.fn() as unknown as typeof fetch;

    const plugin = new __VolatoSourceMapsPlugin({}, { fetchImpl, cwd: root });
    const { compiler, trigger } = makeFakeCompiler(root);
    plugin.apply(compiler);
    await trigger();

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0]?.[0]).toMatch(/NEXT_PUBLIC_VOLATO_DSN/);
  });

  it("invalid DSN → loud warning + no fetch", async () => {
    process.env.NEXT_PUBLIC_VOLATO_DSN = "garbage";
    const { root } = makeBuildDir();
    const fetchImpl = vi.fn() as unknown as typeof fetch;

    const plugin = new __VolatoSourceMapsPlugin({}, { fetchImpl, cwd: root });
    const { compiler, trigger } = makeFakeCompiler(root);
    plugin.apply(compiler);
    await trigger();

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0]?.[0]).toMatch(/not a valid DSN/);
  });

  it("missing build identity → loud warning + no fetch", async () => {
    delete process.env.VOLATO_RELEASE;
    __resetReleaseCacheForTests();
    const { root } = makeBuildDir();
    const fetchImpl = vi.fn() as unknown as typeof fetch;

    const plugin = new __VolatoSourceMapsPlugin({}, { fetchImpl, cwd: root });
    const { compiler, trigger } = makeFakeCompiler(root);
    plugin.apply(compiler);
    await trigger();

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0]?.[0]).toMatch(/no build commit/);
  });

  it("explicit uploadUrl overrides DSN-derived endpoint", async () => {
    delete process.env.NEXT_PUBLIC_VOLATO_DSN;
    const { root } = makeBuildDir();
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (input: URL | string) => {
      calls.push(String(input));
      return new Response(null, { status: 201 });
    }) as unknown as typeof fetch;

    const plugin = new __VolatoSourceMapsPlugin(
      { uploadUrl: "https://custom.example.com/whatever" },
      { fetchImpl, cwd: root },
    );
    const { compiler, trigger } = makeFakeCompiler(root);
    plugin.apply(compiler);
    await trigger();

    expect(calls).toEqual(["https://custom.example.com/api/sourcemaps"]);
  });

  it("summary warning fires when some maps failed", async () => {
    const root = mkdtempSync(join(tmpdir(), "volato-build-"));
    const chunks = join(root, "static", "chunks");
    mkdirSync(chunks, { recursive: true });
    writeFileSync(join(chunks, "page-aaa11111.js.map"), SAMPLE_MAP);
    writeFileSync(join(chunks, "page-bbb22222.js.map"), SAMPLE_MAP);

    let n = 0;
    const fetchImpl = vi.fn(async () => {
      n += 1;
      return new Response(n === 1 ? null : "no", { status: n === 1 ? 201 : 401 });
    }) as unknown as typeof fetch;

    const plugin = new __VolatoSourceMapsPlugin({}, { fetchImpl, cwd: root });
    const { compiler, trigger } = makeFakeCompiler(root);
    plugin.apply(compiler);
    await trigger();

    // Per-failure warning (the 401) + summary warning at the end.
    const summary = warnSpy.mock.calls.find((c) =>
      String(c[0]).includes("1/2 sourcemap(s) failed"),
    );
    expect(summary).toBeDefined();
  });

  it("non-regression: no silent catches when token is set (warns or succeeds, never both empty)", async () => {
    const { root } = makeBuildDir();
    // Inject a fetch that fails with a non-standard error to make sure
    // nothing eats it silently.
    const fetchImpl = vi.fn(async () => {
      throw new Error("boom");
    }) as unknown as typeof fetch;

    const plugin = new __VolatoSourceMapsPlugin({}, { fetchImpl, cwd: root });
    const { compiler, trigger } = makeFakeCompiler(root);
    plugin.apply(compiler);
    await trigger();

    expect(warnSpy.mock.calls.length).toBeGreaterThan(0);
  });
});
