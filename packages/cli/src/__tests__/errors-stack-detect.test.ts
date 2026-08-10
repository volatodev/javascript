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

  it("refuses to apply the React recipe to a Vite + Vue project", () => {
    writePackage(cwd, { vite: "^7.1.1", vue: "^3.5.0" });
    mkdirSync(join(cwd, "src"));
    writeFileSync(join(cwd, "src", "main.ts"), "createApp(App).mount('#app');\n");
    writeFileSync(join(cwd, "vite.config.ts"), "export default defineConfig({});\n");

    expect(() => detectErrorsStack(cwd)).toThrowError(
      /Vite is supported only with React/i,
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
