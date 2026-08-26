import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  detectErrorsStack,
  ErrorsStackDetectionError,
} from "../commands/init/detect-errors";

let cwd: string;

function writePackage(
  root: string,
  dependencies: Record<string, string>,
  extra: Record<string, unknown> = {},
): void {
  mkdirSync(root, { recursive: true });
  writeFileSync(
    join(root, "package.json"),
    `${JSON.stringify({ name: "fixture", dependencies, ...extra }, null, 2)}\n`,
  );
}

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), "volato-errors-detect-"));
});

afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
});

describe("detectErrorsStack", () => {
  it("detects Vite + React and Express independently in one application", () => {
    writePackage(cwd, {
      express: "^5.1.0",
      react: "^19.1.1",
      "react-dom": "^19.1.1",
      vite: "^7.1.1",
    });
    mkdirSync(join(cwd, "src"));
    writeFileSync(join(cwd, "src", "main.tsx"), "createRoot(root).render(<App />);\n");
    writeFileSync(join(cwd, "src", "server.ts"), "const app = express();\napp.listen(3000);\n");
    writeFileSync(join(cwd, "vite.config.ts"), "export default defineConfig({});\n");

    const result = detectErrorsStack(cwd);

    expect(result.nextjs).toBeUndefined();
    expect(result.viteReact).toMatchObject({
      entryPath: join(cwd, "src", "main.tsx"),
      viteConfigPath: join(cwd, "vite.config.ts"),
      language: "ts",
    });
    expect(result.node).toMatchObject({
      entryPath: join(cwd, "src", "server.ts"),
      express: true,
      language: "ts",
    });
  });

  it("does not infer a Node server from a Vite-only frontend toolchain", () => {
    writePackage(cwd, {
      react: "^19.1.1",
      "react-dom": "^19.1.1",
      vite: "^7.1.1",
    });
    mkdirSync(join(cwd, "src"));
    writeFileSync(join(cwd, "src", "main.jsx"), "createRoot(root).render(<App />);\n");
    writeFileSync(join(cwd, "vite.config.js"), "export default defineConfig({});\n");

    const result = detectErrorsStack(cwd);

    expect(result.viteReact?.language).toBe("js");
    expect(result.node).toBeUndefined();
  });

  it.each([
    [
      "Webpack",
      { react: "19.2.8", "react-dom": "19.2.8", webpack: "5.109.2" },
      "webpack.config.cjs",
      "module.exports = {};\n",
      "webpack",
    ],
    [
      "Rspack",
      {
        react: "19.2.8",
        "react-dom": "19.2.8",
        "@rspack/core": "2.2.0",
        "@rspack/cli": "2.2.0",
      },
      "rspack.config.ts",
      "export default {};\n",
      "rspack",
    ],
  ])(
    "detects React with the %s build adapter",
    (_label, dependencies, configName, configSource, adapter) => {
      writePackage(cwd, dependencies);
      mkdirSync(join(cwd, "src"));
      writeFileSync(join(cwd, "src", "main.tsx"), "createRoot(root).render(<App />);\n");
      writeFileSync(join(cwd, configName), configSource);

      expect(detectErrorsStack(cwd).browserReact).toMatchObject({
        entryPath: join(cwd, "src", "main.tsx"),
        buildConfigPath: join(cwd, configName),
        buildAdapter: adapter,
        language: "ts",
      });
    },
  );

  it("refuses ambiguous browser build targets before selecting an adapter", () => {
    writePackage(cwd, {
      react: "19.2.8",
      "react-dom": "19.2.8",
      vite: "8.2.2",
      webpack: "5.109.2",
    });
    mkdirSync(join(cwd, "src"));
    writeFileSync(join(cwd, "src", "main.tsx"), "createRoot(root).render(<App />);\n");
    writeFileSync(join(cwd, "vite.config.ts"), "export default {};\n");
    writeFileSync(join(cwd, "webpack.config.mjs"), "export default {};\n");

    expect(() => detectErrorsStack(cwd)).toThrowError(
      /multiple browser build configurations.*no files were modified/i,
    );
  });

  it("refuses to apply the React recipe to a Vite + Vue project", () => {
    writePackage(cwd, { vite: "^7.1.1", vue: "^3.5.0" });
    mkdirSync(join(cwd, "src"));
    writeFileSync(join(cwd, "src", "main.ts"), "createApp(App).mount('#app');\n");
    writeFileSync(join(cwd, "vite.config.ts"), "export default defineConfig({});\n");

    expect(() => detectErrorsStack(cwd)).toThrowError(
      /Vite is supported only with React/i,
    );
  });

  it.each([
    ["Python", join("backend", "pyproject.toml")],
    ["Go", join("backend", "go.mod")],
    ["PHP", join("backend", "composer.json")],
  ])(
    "keeps Vite browser coverage explicit when a %s backend is unsupported",
    (backend, manifest) => {
      writePackage(cwd, {
        react: "^19.1.1",
        "react-dom": "^19.1.1",
        vite: "^7.1.1",
      });
      mkdirSync(join(cwd, "src"));
      mkdirSync(join(cwd, "backend"));
      writeFileSync(join(cwd, "src", "main.tsx"), "render(<App />);\n");
      writeFileSync(join(cwd, "vite.config.ts"), "export default {};\n");
      writeFileSync(join(cwd, manifest), "fixture\n");

      const result = detectErrorsStack(cwd);

      expect(result.viteReact).toBeDefined();
      expect(result.node).toBeUndefined();
      expect(result.notices).toContainEqual(
        expect.stringMatching(
          new RegExp(`${backend} backend.*not supported.*browser`, "i"),
        ),
      );
    },
  );

  it("announces an unsupported Node HTTP framework even without a conventional server entry", () => {
    writePackage(cwd, {
      fastify: "^5.6.0",
      react: "^19.1.1",
      "react-dom": "^19.1.1",
      vite: "^7.1.1",
    });
    mkdirSync(join(cwd, "src"));
    writeFileSync(join(cwd, "src", "main.tsx"), "render(<App />);\n");
    writeFileSync(join(cwd, "src", "api.ts"), "startFastify();\n");
    writeFileSync(join(cwd, "vite.config.ts"), "export default {};\n");

    const result = detectErrorsStack(cwd);

    expect(result.viteReact).toBeDefined();
    expect(result.node).toBeUndefined();
    expect(result.notices).toContainEqual(
      expect.stringMatching(/fastify.*not supported.*server.*not modified/i),
    );
  });

  it("requires an explicit application root for an ambiguous monorepo", () => {
    writePackage(cwd, {}, { workspaces: ["apps/*"] });
    for (const name of ["web-a", "web-b"]) {
      const root = join(cwd, "apps", name);
      writePackage(root, { react: "^19.1.1", vite: "^7.1.1" });
      mkdirSync(join(root, "src"));
      writeFileSync(join(root, "src", "main.tsx"), "render(<App />);\n");
      writeFileSync(join(root, "vite.config.ts"), "export default {};\n");
    }

    expect(() => detectErrorsStack(cwd)).toThrowError(
      ErrorsStackDetectionError,
    );
    expect(() => detectErrorsStack(cwd)).toThrowError(
      /multiple supported applications.*run.*application root/i,
    );
  });
});
