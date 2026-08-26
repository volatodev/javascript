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
import { withVolato } from "../withVolato";

// The build-time warning fires whenever VOLATO_INGEST_TOKEN is unset.
// Set a sentinel value for the whole file so the legacy tests don't
// pollute stderr with warning lines; the dedicated warning suite
// below clears + restores the env around each of its cases.
const SUITE_ORIGINAL_TOKEN = process.env.VOLATO_INGEST_TOKEN;
beforeAll(() => {
  process.env.VOLATO_INGEST_TOKEN = "test-token-suite-default";
});
afterAll(() => {
  if (SUITE_ORIGINAL_TOKEN === undefined) {
    delete process.env.VOLATO_INGEST_TOKEN;
  } else {
    process.env.VOLATO_INGEST_TOKEN = SUITE_ORIGINAL_TOKEN;
  }
});

describe("withVolato", () => {
  it("forces productionBrowserSourceMaps on", () => {
    const out = withVolato({ reactStrictMode: true });
    expect(out.productionBrowserSourceMaps).toBe(true);
    expect(out.experimental?.serverSourceMaps).toBe(true);
    expect(out.reactStrictMode).toBe(true);
  });

  it("preserves user-provided keys", () => {
    const out = withVolato({
      reactStrictMode: false,
      images: { remotePatterns: [{ hostname: "x.com" }] },
    } as Record<string, unknown>);
    expect(out.reactStrictMode).toBe(false);
    expect((out as Record<string, unknown>).images).toEqual({
      remotePatterns: [{ hostname: "x.com" }],
    });
  });

  it("composes a user-provided webpack(): function instead of replacing it", () => {
    const userWebpack = (config: { plugins?: unknown[] }) => {
      config.plugins = config.plugins ?? [];
      config.plugins.push("USER_PLUGIN_MARKER");
      return config;
    };
    const out = withVolato({ webpack: userWebpack });
    const cfg = { plugins: [] as unknown[] };
    const result = out.webpack!(cfg, { isServer: false }) as {
      plugins: unknown[];
    };
    // user plugin first, then Volato plugin appended
    expect(result.plugins[0]).toBe("USER_PLUGIN_MARKER");
    expect(result.plugins.length).toBe(2);
    const volatoPlugin = result.plugins[1] as { apply: unknown };
    expect(typeof volatoPlugin.apply).toBe("function");
  });

  it("uploads maps from the server bundle", () => {
    const out = withVolato({});
    const cfg = { plugins: [] as unknown[] };
    out.webpack!(cfg, { isServer: true });
    expect(cfg.plugins).toHaveLength(1);
    expect(typeof (cfg.plugins[0] as { apply: unknown }).apply).toBe(
      "function",
    );
  });

  it("does not upload transient development maps", () => {
    const out = withVolato({});
    const cfg = { plugins: [] as unknown[] };
    out.webpack!(cfg, { isServer: true, dev: true });
    expect(cfg.plugins).toHaveLength(0);
  });

  it("disableUpload skips the webpack hook entirely but still emits maps", () => {
    const out = withVolato({}, { disableUpload: true });
    expect(out.productionBrowserSourceMaps).toBe(true);
    expect(out.experimental?.serverSourceMaps).toBe(true);
    expect(out.webpack).toBeUndefined();
  });

  it("uses the native Next.js 16 post-compile hook without adding a webpack config", () => {
    const out = withVolato({}, { nextMajor: 16 });
    const compiler = (
      out as {
        compiler?: { runAfterProductionCompile?: unknown };
      }
    ).compiler;

    expect(out.webpack).toBeUndefined();
    expect(typeof compiler?.runAfterProductionCompile).toBe("function");
  });
});

describe("withVolato — VOLATO_INGEST_TOKEN warning", () => {
  const originalToken = process.env.VOLATO_INGEST_TOKEN;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
    if (originalToken === undefined) {
      delete process.env.VOLATO_INGEST_TOKEN;
    } else {
      process.env.VOLATO_INGEST_TOKEN = originalToken;
    }
  });

  it("warns once when VOLATO_INGEST_TOKEN is missing", () => {
    delete process.env.VOLATO_INGEST_TOKEN;
    withVolato({});
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0]?.[0]).toMatch(/VOLATO_INGEST_TOKEN/);
    expect(warnSpy.mock.calls[0]?.[0]).toMatch(
      /sourcemaps will not be uploaded/,
    );
  });

  it("does NOT warn when the token is present", () => {
    process.env.VOLATO_INGEST_TOKEN = "test-token";
    withVolato({});
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("does NOT warn when disableUpload is set (explicit opt-out)", () => {
    delete process.env.VOLATO_INGEST_TOKEN;
    withVolato({}, { disableUpload: true });
    expect(warnSpy).not.toHaveBeenCalled();
  });
});
