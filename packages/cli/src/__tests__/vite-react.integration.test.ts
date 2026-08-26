import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { detectErrorsStack } from "../commands/init/detect-errors";
import {
  generateBrowserReactIntegration,
  generateViteReactIntegration,
} from "../integrations/vite-react";
import {
  ERRORS_VITE_REACT_INTEGRATION,
  linkProject,
  modifiedGeneratedFiles,
  readManifest,
} from "../integrations/manifest";

let cwd: string;

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), "volato-vite-react-"));
  mkdirSync(join(cwd, "src"));
  writeFileSync(
    join(cwd, "package.json"),
    `${JSON.stringify({
      name: "fixture",
      scripts: { build: "vite build" },
      dependencies: {
        react: "19.1.1",
        "react-dom": "19.1.1",
        vite: "7.1.1",
      },
    }, null, 2)}\n`,
  );
  writeFileSync(
    join(cwd, "src", "main.tsx"),
    'import { createRoot } from "react-dom/client";\nimport App from "./App";\ncreateRoot(document.getElementById("root")!).render(<App />);\n',
  );
  writeFileSync(
    join(cwd, "vite.config.ts"),
    'import { defineConfig } from "vite";\nexport default defineConfig({});\n',
  );
  linkProject(cwd, {
    id: "11111111-1111-4111-8111-111111111111",
    name: "Fixture",
  });
});

afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
});

describe("Vite + React generated integration", () => {
  it("generates browser capture, composes the clean React root, and wraps Vite", () => {
    const project = detectErrorsStack(cwd).viteReact!;
    const result = generateViteReactIntegration({
      cwd,
      project,
      dsn: "https://pk@api.volato.dev/project",
      ingestToken: "server-only-token",
    });

    expect(existsSync(join(cwd, "src", "volato", "browser.ts"))).toBe(true);
    expect(existsSync(join(cwd, "src", "volato", "react.tsx"))).toBe(true);
    expect(existsSync(join(cwd, "src", "volato", "vite.ts"))).toBe(true);
    const browserSource = readFileSync(
      join(cwd, "src", "volato", "browser.ts"),
      "utf8",
    );
    expect(browserSource).not.toMatch(/from ["']react["']/);
    expect(browserSource).not.toContain("import.meta.env");
    expect(readFileSync(project.entryPath, "utf8")).toContain(
      'from "./volato/react"',
    );
    expect(readFileSync(project.entryPath, "utf8")).toContain(
      'import { initVolatoBrowser } from "./volato/browser"',
    );
    expect(readFileSync(project.entryPath, "utf8")).toMatch(
      /initVolatoBrowser\(\);[\s\S]*\.render\(/,
    );
    expect(readFileSync(project.entryPath, "utf8")).toContain(
      "<VolatoErrorBoundary>",
    );
    expect(readFileSync(project.entryPath, "utf8")).toContain(
      "<VolatoBootstrap />",
    );
    expect(readFileSync(project.viteConfigPath, "utf8")).toContain(
      "withVolato",
    );
    expect(readFileSync(join(cwd, ".env.local"), "utf8")).toContain(
      "VITE_VOLATO_DSN=https://pk@api.volato.dev/project",
    );
    expect(readFileSync(join(cwd, ".env.local"), "utf8")).toContain(
      "VOLATO_INGEST_TOKEN=server-only-token",
    );

    const integration = readManifest(cwd)?.integrations[
      ERRORS_VITE_REACT_INTEGRATION
    ];
    expect(integration?.recipe).toBe("errors-browser-react");
    expect(modifiedGeneratedFiles(cwd, integration!)).toEqual([]);
    expect(result.outcomes.every((outcome) => outcome.status !== "manual")).toBe(
      true,
    );
  });

  it("generates JavaScript browser, React, and Vite sources for a JavaScript app", () => {
    rmSync(join(cwd, "src", "main.tsx"));
    rmSync(join(cwd, "vite.config.ts"));
    writeFileSync(
      join(cwd, "src", "main.jsx"),
      'import { createRoot } from "react-dom/client";\nimport App from "./App";\ncreateRoot(document.getElementById("root")).render(<App />);\n',
    );
    writeFileSync(
      join(cwd, "vite.config.js"),
      'import { defineConfig } from "vite";\nexport default defineConfig({});\n',
    );

    const project = detectErrorsStack(cwd).viteReact!;
    const result = generateViteReactIntegration({
      cwd,
      project,
      dsn: "https://pk@api.volato.dev/project",
    });

    for (const file of ["browser.js", "react.jsx", "vite.js"]) {
      expect(existsSync(join(cwd, "src", "volato", file))).toBe(true);
    }
    expect(existsSync(join(cwd, "src", "volato", "browser.ts"))).toBe(false);
    expect(readFileSync(project.entryPath, "utf8")).toContain(
      'from "./volato/react"',
    );
    expect(result.outcomes.every((outcome) => outcome.status !== "manual")).toBe(
      true,
    );
  });

  it("leaves an existing application Error Boundary as a precise manual action", () => {
    writeFileSync(
      join(cwd, "src", "main.tsx"),
      'createRoot(root).render(<ExistingErrorBoundary><App /></ExistingErrorBoundary>);\n',
    );

    const result = generateViteReactIntegration({
      cwd,
      project: detectErrorsStack(cwd).viteReact!,
      dsn: "https://pk@api.volato.dev/project",
    });

    expect(result.outcomes).toContainEqual(
      expect.objectContaining({
        path: join(cwd, "src", "main.tsx"),
        status: "manual",
        detail: expect.stringMatching(/existing React Error Boundary/i),
      }),
    );
    expect(readFileSync(join(cwd, "src", "main.tsx"), "utf8")).not.toContain(
      "VolatoErrorBoundary",
    );
  });

  it("preserves providers and StrictMode around the existing application root", () => {
    writeFileSync(
      join(cwd, "src", "main.tsx"),
      'import React from "react";\ncreateRoot(root).render(<React.StrictMode><ThemeProvider><App /></ThemeProvider></React.StrictMode>);\n',
    );

    const result = generateViteReactIntegration({
      cwd,
      project: detectErrorsStack(cwd).viteReact!,
      dsn: "https://pk@api.volato.dev/project",
    });

    const entry = readFileSync(join(cwd, "src", "main.tsx"), "utf8");
    expect(result.outcomes.every((outcome) => outcome.status !== "manual")).toBe(
      true,
    );
    expect(entry).toContain(
      "<React.StrictMode><ThemeProvider><App /></ThemeProvider></React.StrictMode>",
    );
    expect(entry).toContain("<VolatoErrorBoundary>");
  });

  it("refuses multiple React roots before changing the entry", () => {
    const original =
      'createRoot(first).render(<App />);\ncreateRoot(second).render(<Admin />);\n';
    writeFileSync(join(cwd, "src", "main.tsx"), original);

    const result = generateViteReactIntegration({
      cwd,
      project: detectErrorsStack(cwd).viteReact!,
      dsn: "https://pk@api.volato.dev/project",
    });

    expect(result.outcomes).toContainEqual(
      expect.objectContaining({
        status: "manual",
        detail: expect.stringMatching(/multiple React roots/i),
      }),
    );
    expect(readFileSync(join(cwd, "src", "main.tsx"), "utf8")).toBe(original);
  });

  it("generates and composes the CommonJS Webpack build adapter", () => {
    const pkg = JSON.parse(readFileSync(join(cwd, "package.json"), "utf8"));
    delete pkg.dependencies.vite;
    pkg.dependencies.webpack = "5.109.2";
    writeFileSync(join(cwd, "package.json"), `${JSON.stringify(pkg, null, 2)}\n`);
    rmSync(join(cwd, "vite.config.ts"));
    writeFileSync(
      join(cwd, "webpack.config.cjs"),
      'module.exports = { mode: "production", entry: "./src/main.tsx" };\n',
    );

    const project = detectErrorsStack(cwd).browserReact!;
    const result = generateBrowserReactIntegration({
      cwd,
      project,
      dsn: "https://pk@api.volato.dev/project",
      ingestToken: "server-only-token",
    });

    expect(project.buildAdapter).toBe("webpack");
    expect(existsSync(join(cwd, "src", "volato", "webpack.cjs"))).toBe(true);
    expect(readFileSync(project.buildConfigPath, "utf8")).toMatch(
      /require\(["'].+webpack\.cjs["']\)/,
    );
    expect(readFileSync(project.buildConfigPath, "utf8")).toContain(
      "withVolatoWebpack",
    );
    expect(readFileSync(join(cwd, ".env.local"), "utf8")).toContain(
      "VOLATO_DSN=https://pk@api.volato.dev/project",
    );
    expect(result.outcomes.every((outcome) => outcome.status !== "manual")).toBe(
      true,
    );
  });

  it("generates and composes the TypeScript Rspack build adapter", () => {
    const pkg = JSON.parse(readFileSync(join(cwd, "package.json"), "utf8"));
    delete pkg.dependencies.vite;
    pkg.dependencies["@rspack/core"] = "2.2.0";
    pkg.dependencies["@rspack/cli"] = "2.2.0";
    writeFileSync(join(cwd, "package.json"), `${JSON.stringify(pkg, null, 2)}\n`);
    rmSync(join(cwd, "vite.config.ts"));
    writeFileSync(
      join(cwd, "rspack.config.ts"),
      'import { defineConfig } from "@rspack/cli";\nexport default defineConfig({});\n',
    );

    const project = detectErrorsStack(cwd).browserReact!;
    const result = generateBrowserReactIntegration({
      cwd,
      project,
      dsn: "https://pk@api.volato.dev/project",
    });

    expect(project.buildAdapter).toBe("rspack");
    expect(existsSync(join(cwd, "src", "volato", "rspack.ts"))).toBe(true);
    expect(existsSync(join(cwd, "src", "volato", "artifact.ts"))).toBe(true);
    expect(readFileSync(project.buildConfigPath, "utf8")).toContain(
      "withVolatoRspack",
    );
    expect(result.outcomes.every((outcome) => outcome.status !== "manual")).toBe(
      true,
    );
  });

  it("refuses a dynamic browser build config before mutating any file", () => {
    const pkg = JSON.parse(readFileSync(join(cwd, "package.json"), "utf8"));
    delete pkg.dependencies.vite;
    pkg.dependencies.webpack = "5.109.2";
    writeFileSync(join(cwd, "package.json"), `${JSON.stringify(pkg, null, 2)}\n`);
    rmSync(join(cwd, "vite.config.ts"));
    const config = 'export default async () => ({ mode: "production" });\n';
    writeFileSync(join(cwd, "webpack.config.mjs"), config);
    const entry = readFileSync(join(cwd, "src", "main.tsx"), "utf8");

    expect(() =>
      generateBrowserReactIntegration({
        cwd,
        project: detectErrorsStack(cwd).browserReact!,
        dsn: "https://pk@api.volato.dev/project",
      }),
    ).toThrowError(/dynamic Webpack config.*no files were modified/i);
    expect(readFileSync(join(cwd, "webpack.config.mjs"), "utf8")).toBe(config);
    expect(readFileSync(join(cwd, "src", "main.tsx"), "utf8")).toBe(entry);
    expect(existsSync(join(cwd, ".env.local"))).toBe(false);
    expect(existsSync(join(cwd, "src", "volato"))).toBe(false);
  });
});
