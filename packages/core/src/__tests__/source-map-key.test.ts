import { describe, expect, it } from "vitest";
import { projectFramePath } from "../source-map-key.js";

describe("projectFramePath — happy paths (returns a key)", () => {
  it("extracts filename_hash from a runtime URL with default config", () => {
    const out = projectFramePath(
      "https://app.example.com/_next/static/chunks/page-abc12345.js",
    );
    expect(out).toEqual({
      filename_hash: "abc12345",
      display_path: "static/chunks/page-abc12345.js",
    });
  });

  it("extracts filename_hash with a Next basePath in the URL", () => {
    const out = projectFramePath(
      "https://app.example.com/myapp/_next/static/chunks/page-abc12345.js",
    );
    expect(out?.filename_hash).toBe("abc12345");
    expect(out?.display_path).toBe("static/chunks/page-abc12345.js");
  });

  it("extracts filename_hash with an assetPrefix CDN URL", () => {
    const out = projectFramePath(
      "https://cdn.example.com/v3/_next/static/chunks/page-abc12345.js",
    );
    expect(out?.filename_hash).toBe("abc12345");
    expect(out?.display_path).toBe("static/chunks/page-abc12345.js");
  });

  it("extracts filename_hash from a build-dir-relative path", () => {
    const out = projectFramePath(".next/static/chunks/page-abc12345.js");
    expect(out?.filename_hash).toBe("abc12345");
    expect(out?.display_path).toBe("static/chunks/page-abc12345.js");
  });

  it("converges: runtime URL and build-dir path produce the same key", () => {
    const fromUrl = projectFramePath(
      "https://app.example.com/_next/static/chunks/page-abc12345.js",
    );
    const fromBuild = projectFramePath(
      ".next/static/chunks/page-abc12345.js",
    );
    expect(fromUrl).toEqual(fromBuild);
  });

  it("strips a query string from the runtime URL", () => {
    const out = projectFramePath(
      "https://app.example.com/_next/static/chunks/page-abc12345.js?v=1",
    );
    expect(out?.filename_hash).toBe("abc12345");
    expect(out?.display_path).toBe("static/chunks/page-abc12345.js");
  });

  it("strips a fragment from the runtime URL", () => {
    const out = projectFramePath(
      "https://app.example.com/_next/static/chunks/page-abc12345.js#frag",
    );
    expect(out?.filename_hash).toBe("abc12345");
    expect(out?.display_path).toBe("static/chunks/page-abc12345.js");
  });

  it("accepts a 20-char hash (Next 15 long-hash chunks)", () => {
    const out = projectFramePath(
      "https://app.example.com/_next/static/chunks/main-app-abcdef0123456789abcd.js",
    );
    expect(out?.filename_hash).toBe("abcdef0123456789abcd");
  });

  it("extracts from a chunk in a sub-directory under chunks/", () => {
    const out = projectFramePath(
      ".next/static/chunks/app/page-abc12345.js",
    );
    expect(out?.filename_hash).toBe("abc12345");
    expect(out?.display_path).toBe("static/chunks/app/page-abc12345.js");
  });

  it("ignores a hash-looking segment in a directory; anchors to the .js filename", () => {
    const out = projectFramePath(
      "https://cdn.example.com/v1234567890ab/_next/static/chunks/page-def67890.js",
    );
    expect(out?.filename_hash).toBe("def67890");
  });

  it("tolerates a `.map` suffix defensively (CLI normally strips it)", () => {
    const out = projectFramePath(".next/static/chunks/page-abc12345.js.map");
    expect(out?.filename_hash).toBe("abc12345");
  });
});

describe("projectFramePath — null returns (no usable key)", () => {
  it("returns null on empty input", () => {
    expect(projectFramePath("")).toBeNull();
  });

  it("returns null on a webpack-internal frame (pre-prune)", () => {
    expect(
      projectFramePath(
        "webpack-internal:///(app-pages-browser)/./app/page.tsx",
      ),
    ).toBeNull();
  });

  it("returns null on an unhashed filename (custom build)", () => {
    expect(
      projectFramePath("https://app.example.com/_next/static/chunks/page.js"),
    ).toBeNull();
  });

  it("returns null on a hash too short (7 hex chars)", () => {
    expect(
      projectFramePath(
        "https://app.example.com/_next/static/chunks/page-abc1234.js",
      ),
    ).toBeNull();
  });

  it("returns null on a server-side filesystem frame (out of scope for v0)", () => {
    expect(projectFramePath("/var/task/.next/server/app/page.js")).toBeNull();
  });

  it("returns null on a `<anonymous>` synthetic frame", () => {
    expect(projectFramePath("<anonymous>")).toBeNull();
  });

  it("returns null on a node:* runtime frame", () => {
    expect(projectFramePath("node:async_hooks")).toBeNull();
  });
});
