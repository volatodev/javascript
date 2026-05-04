import { describe, expect, it } from "vitest";
import { withVolato } from "../withVolato";

describe("withVolato", () => {
  it("forces productionBrowserSourceMaps on", () => {
    const out = withVolato({ reactStrictMode: true });
    expect(out.productionBrowserSourceMaps).toBe(true);
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

  it("does not push the plugin into the server bundle", () => {
    const out = withVolato({});
    const cfg = { plugins: [] as unknown[] };
    out.webpack!(cfg, { isServer: true });
    expect(cfg.plugins.length).toBe(0);
  });

  it("disableUpload skips the webpack hook entirely but still emits maps", () => {
    const out = withVolato({}, { disableUpload: true });
    expect(out.productionBrowserSourceMaps).toBe(true);
    expect(out.webpack).toBeUndefined();
  });
});
