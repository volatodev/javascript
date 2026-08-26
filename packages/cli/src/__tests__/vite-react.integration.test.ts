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
import { generateViteReactIntegration } from "../integrations/vite-react";
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
    expect(integration?.recipe).toBe("errors-vite-react");
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
});
