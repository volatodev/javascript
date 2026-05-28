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

  it("throws DetectionError when no App Router layout exists", () => {
    makePackageJson();
    mkdirSync(join(cwd, "pages"));
    writeFileSync(
      join(cwd, "pages", "index.tsx"),
      "export default () => null;",
    );

    expect(() => detectProject(cwd)).toThrow(/App Router/);
  });

  it("locates next.config.ts and computes the tunnel route path", () => {
    makePackageJson();
    mkdirSync(join(cwd, "app"));
    writeFileSync(join(cwd, "app", "layout.tsx"), "export default () => null;");
    writeFileSync(join(cwd, "next.config.ts"), "export default {};");

    const project = detectProject(cwd);
    expect(project.nextConfigPath).toBe(join(cwd, "next.config.ts"));
    expect(project.tunnelRoutePath).toBe(
      join(cwd, "app", "monitoring", "route.ts"),
    );
  });

  it("falls back to next.config.mjs / .js / .cjs in priority order", () => {
    makePackageJson();
    mkdirSync(join(cwd, "app"));
    writeFileSync(join(cwd, "app", "layout.tsx"), "export default () => null;");
    writeFileSync(join(cwd, "next.config.js"), "module.exports = {};");

    const project = detectProject(cwd);
    expect(project.nextConfigPath).toBe(join(cwd, "next.config.js"));
  });

  it("returns null nextConfigPath when no config file exists", () => {
    makePackageJson();
    mkdirSync(join(cwd, "app"));
    writeFileSync(join(cwd, "app", "layout.tsx"), "export default () => null;");

    expect(detectProject(cwd).nextConfigPath).toBeNull();
  });

  it("uses the right extension for the tunnel route in JS projects", () => {
    makePackageJson();
    mkdirSync(join(cwd, "app"));
    writeFileSync(join(cwd, "app", "layout.jsx"), "export default () => null;");

    const project = detectProject(cwd);
    expect(project.tunnelRoutePath).toBe(
      join(cwd, "app", "monitoring", "route.js"),
    );
  });
});
