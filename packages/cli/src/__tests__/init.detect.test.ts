import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { detectProject, DetectionError } from "../commands/init/detect";

let cwd: string;

function makePackageJson(extra: Record<string, unknown> = {}): void {
  writeFileSync(
    join(cwd, "package.json"),
    JSON.stringify({
      name: "fixture",
      dependencies: { next: "15.0.0" },
      ...extra,
    }),
  );
}

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), "volato-detect-"));
});

afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
});

describe("detectProject", () => {
  it("detects an App Router at the project root", () => {
    makePackageJson();
    mkdirSync(join(cwd, "app"));
    writeFileSync(join(cwd, "app", "layout.tsx"), "export default () => null;");

    const project = detectProject(cwd);

    expect(project.appDir).toBe("app");
    expect(project.layoutPath).toBe(join(cwd, "app", "layout.tsx"));
    expect(project.instrumentationPath).toBe(join(cwd, "instrumentation.ts"));
    expect(project.middlewarePath).toBeNull();
    expect(project.language).toBe("ts");
  });

  it("prefers `src/app` when present and routes instrumentation into `src/`", () => {
    makePackageJson();
    mkdirSync(join(cwd, "src", "app"), { recursive: true });
    writeFileSync(
      join(cwd, "src", "app", "layout.tsx"),
      "export default () => null;",
    );

    const project = detectProject(cwd);

    expect(project.appDir).toBe("src/app");
    expect(project.instrumentationPath).toBe(
      join(cwd, "src", "instrumentation.ts"),
    );
  });

  it("picks up `.jsx` layouts and switches to JS instrumentation", () => {
    makePackageJson();
    mkdirSync(join(cwd, "app"));
    writeFileSync(join(cwd, "app", "layout.jsx"), "export default () => null;");

    const project = detectProject(cwd);

    expect(project.language).toBe("js");
    expect(project.instrumentationPath).toBe(join(cwd, "instrumentation.js"));
  });

  it("locates a `middleware.ts` at the project root", () => {
    makePackageJson();
    mkdirSync(join(cwd, "app"));
    writeFileSync(join(cwd, "app", "layout.tsx"), "export default () => null;");
    writeFileSync(join(cwd, "middleware.ts"), "export default () => {};");

    const project = detectProject(cwd);

    expect(project.middlewarePath).toBe(join(cwd, "middleware.ts"));
  });

  it("locates a middleware in `src/`", () => {
    makePackageJson();
    mkdirSync(join(cwd, "src", "app"), { recursive: true });
    writeFileSync(
      join(cwd, "src", "app", "layout.tsx"),
      "export default () => null;",
    );
    writeFileSync(
      join(cwd, "src", "middleware.ts"),
      "export default () => {};",
    );

    const project = detectProject(cwd);

    expect(project.middlewarePath).toBe(join(cwd, "src", "middleware.ts"));
  });

  it("locates a Next.js 16 `proxy.ts` at the application root", () => {
    makePackageJson({ dependencies: { next: "16.2.12" } });
    mkdirSync(join(cwd, "app"));
    writeFileSync(join(cwd, "app", "layout.tsx"), "export default () => null;");
    writeFileSync(join(cwd, "proxy.ts"), "export function proxy() {};");

    const project = detectProject(cwd);

    expect(project.proxyPath).toBe(join(cwd, "proxy.ts"));
    expect(project.middlewarePath).toBeNull();
  });

  it("ignores the proxy convention before Next.js 16", () => {
    makePackageJson();
    mkdirSync(join(cwd, "app"));
    writeFileSync(join(cwd, "app", "layout.tsx"), "export default () => null;");
    writeFileSync(join(cwd, "proxy.ts"), "export function proxy() {};\n");

    expect(detectProject(cwd).proxyPath).toBeNull();
  });

  it("throws DetectionError when package.json is missing", () => {
    expect(() => detectProject(cwd)).toThrow(DetectionError);
  });

  it("throws DetectionError when Next.js is not in deps", () => {
    writeFileSync(
      join(cwd, "package.json"),
      JSON.stringify({ name: "fixture", dependencies: {} }),
    );
    mkdirSync(join(cwd, "app"));
    writeFileSync(join(cwd, "app", "layout.tsx"), "export default () => null;");

    expect(() => detectProject(cwd)).toThrow(/Next\.js is not listed/);
  });

  it("accepts Next.js declared via devDependencies", () => {
    writeFileSync(
      join(cwd, "package.json"),
      JSON.stringify({ name: "fixture", devDependencies: { next: "15.0.0" } }),
    );
    mkdirSync(join(cwd, "app"));
    writeFileSync(join(cwd, "app", "layout.tsx"), "export default () => null;");

    expect(() => detectProject(cwd)).not.toThrow();
  });

  it("rejects Next.js versions older than 15", () => {
    makePackageJson({ dependencies: { next: "^14.2.0" } });
    mkdirSync(join(cwd, "app"));
    writeFileSync(join(cwd, "app", "layout.tsx"), "export default () => null;");

    expect(() => detectProject(cwd)).toThrow(/Next\.js 15 or newer/);
  });

  it("rejects a version specifier whose major cannot be confirmed", () => {
    makePackageJson({ dependencies: { next: "latest" } });
    mkdirSync(join(cwd, "app"));
    writeFileSync(join(cwd, "app", "layout.tsx"), "export default () => null;");

    expect(() => detectProject(cwd)).toThrow(
      /Cannot confirm the Next\.js version/,
    );
  });

  it("detects a TypeScript Pages Router when no App Router exists", () => {
    makePackageJson();
    mkdirSync(join(cwd, "pages"));
    writeFileSync(
      join(cwd, "pages", "index.tsx"),
      "export default () => null;",
    );

    const project = detectProject(cwd);

    expect(project.routerKind).toBe("pages");
    expect(project.appDir).toBeNull();
    expect(project.pagesDir).toBe("pages");
    expect(project.pagesAppPath).toBe(join(cwd, "pages", "_app.tsx"));
    expect(project.pagesErrorPath).toBe(join(cwd, "pages", "_error.tsx"));
    expect(project.instrumentationPath).toBe(join(cwd, "instrumentation.ts"));
    expect(project.language).toBe("ts");
  });

  it("detects a JavaScript Pages Router under src and preserves existing reserved files", () => {
    makePackageJson();
    mkdirSync(join(cwd, "src", "pages"), { recursive: true });
    writeFileSync(
      join(cwd, "src", "pages", "index.jsx"),
      "export default () => null;",
    );
    writeFileSync(
      join(cwd, "src", "pages", "_app.js"),
      "export default function App({ Component, pageProps }) { return <Component {...pageProps} />; }",
    );
    writeFileSync(
      join(cwd, "src", "pages", "_error.js"),
      "export default function Error() { return null; }",
    );

    const project = detectProject(cwd);

    expect(project.routerKind).toBe("pages");
    expect(project.pagesDir).toBe("src/pages");
    expect(project.pagesAppPath).toBe(join(cwd, "src", "pages", "_app.js"));
    expect(project.pagesErrorPath).toBe(join(cwd, "src", "pages", "_error.js"));
    expect(project.instrumentationPath).toBe(
      join(cwd, "src", "instrumentation.js"),
    );
    expect(project.language).toBe("js");
  });

  it("detects an App + Pages hybrid and keeps both router entry points", () => {
    makePackageJson();
    mkdirSync(join(cwd, "src", "app"), { recursive: true });
    mkdirSync(join(cwd, "src", "pages"), { recursive: true });
    writeFileSync(
      join(cwd, "src", "app", "layout.tsx"),
      "export default () => null;",
    );
    writeFileSync(
      join(cwd, "src", "pages", "legacy.tsx"),
      "export default () => null;",
    );

    const project = detectProject(cwd);

    expect(project.routerKind).toBe("hybrid");
    expect(project.appDir).toBe("src/app");
    expect(project.pagesDir).toBe("src/pages");
    expect(project.layoutPath).toBe(join(cwd, "src", "app", "layout.tsx"));
    expect(project.pagesAppPath).toBe(join(cwd, "src", "pages", "_app.tsx"));
    expect(project.pagesErrorPath).toBe(
      join(cwd, "src", "pages", "_error.tsx"),
    );
    expect(project.instrumentationPath).toBe(
      join(cwd, "src", "instrumentation.ts"),
    );
  });

  it("matches Next.js root precedence independently for each router", () => {
    makePackageJson();
    mkdirSync(join(cwd, "app"), { recursive: true });
    mkdirSync(join(cwd, "src", "app"), { recursive: true });
    mkdirSync(join(cwd, "src", "pages"), { recursive: true });
    writeFileSync(
      join(cwd, "app", "layout.jsx"),
      "export default () => null;",
    );
    writeFileSync(
      join(cwd, "src", "app", "layout.tsx"),
      "export default () => null;",
    );
    writeFileSync(
      join(cwd, "src", "pages", "legacy.jsx"),
      "export default () => null;",
    );

    const project = detectProject(cwd);

    expect(project.routerKind).toBe("hybrid");
    expect(project.appDir).toBe("app");
    expect(project.layoutPath).toBe(join(cwd, "app", "layout.jsx"));
    expect(project.pagesDir).toBe("src/pages");
    expect(project.instrumentationPath).toBe(
      join(cwd, "src", "instrumentation.js"),
    );
  });

  it("places instrumentation beside root Pages when App Router lives in src", () => {
    makePackageJson();
    mkdirSync(join(cwd, "pages"), { recursive: true });
    mkdirSync(join(cwd, "src", "app"), { recursive: true });
    writeFileSync(
      join(cwd, "pages", "legacy.tsx"),
      "export default () => null;",
    );
    writeFileSync(
      join(cwd, "src", "app", "layout.tsx"),
      "export default () => null;",
    );

    const project = detectProject(cwd);

    expect(project.routerKind).toBe("hybrid");
    expect(project.appDir).toBe("src/app");
    expect(project.pagesDir).toBe("pages");
    expect(project.instrumentationPath).toBe(join(cwd, "instrumentation.ts"));
  });

  it("rejects a mixed-root hybrid on Next.js 16 before modifying it", () => {
    makePackageJson({ dependencies: { next: "16.2.12" } });
    mkdirSync(join(cwd, "pages"), { recursive: true });
    mkdirSync(join(cwd, "src", "app"), { recursive: true });
    writeFileSync(
      join(cwd, "pages", "legacy.jsx"),
      "export default () => null;",
    );
    writeFileSync(
      join(cwd, "src", "app", "layout.jsx"),
      "export default () => null;",
    );

    expect(() => detectProject(cwd)).toThrow(
      /Next\.js 16 requires `app` and `pages` under the same root/,
    );
  });

  it("rejects a Next.js project with neither router", () => {
    makePackageJson();

    expect(() => detectProject(cwd)).toThrow(/app\/.*layout|pages/);
  });

  it("locates next.config.ts and computes the error boundary path", () => {
    makePackageJson();
    mkdirSync(join(cwd, "app"));
    writeFileSync(join(cwd, "app", "layout.tsx"), "export default () => null;");
    writeFileSync(join(cwd, "next.config.ts"), "export default {};");

    const project = detectProject(cwd);
    expect(project.nextConfigPath).toBe(join(cwd, "next.config.ts"));
    expect(project.errorBoundaryPath).toBe(join(cwd, "app", "error.tsx"));
  });

  it("falls back to next.config.mjs / .js in priority order", () => {
    makePackageJson();
    mkdirSync(join(cwd, "app"));
    writeFileSync(join(cwd, "app", "layout.tsx"), "export default () => null;");
    writeFileSync(join(cwd, "next.config.js"), "module.exports = {};");

    const project = detectProject(cwd);
    expect(project.nextConfigPath).toBe(join(cwd, "next.config.js"));
  });

  it("does not select next.config.cjs because Next.js does not support it", () => {
    makePackageJson();
    mkdirSync(join(cwd, "app"));
    writeFileSync(join(cwd, "app", "layout.tsx"), "export default () => null;");
    writeFileSync(join(cwd, "next.config.cjs"), "module.exports = {};\n");

    expect(detectProject(cwd).nextConfigPath).toBeNull();
  });

  it("returns null nextConfigPath when no config file exists", () => {
    makePackageJson();
    mkdirSync(join(cwd, "app"));
    writeFileSync(join(cwd, "app", "layout.tsx"), "export default () => null;");

    expect(detectProject(cwd).nextConfigPath).toBeNull();
  });

  it("uses the right extension for the error boundary in JS projects", () => {
    makePackageJson();
    mkdirSync(join(cwd, "app"));
    writeFileSync(join(cwd, "app", "layout.jsx"), "export default () => null;");

    const project = detectProject(cwd);
    expect(project.errorBoundaryPath).toBe(join(cwd, "app", "error.jsx"));
  });
});
