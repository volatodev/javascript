import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { detectErrorsStack } from "../commands/init/detect-errors";
import { generateSvelteKitIntegration } from "../integrations/sveltekit";
import {
  ERRORS_SVELTEKIT_INTEGRATION,
  linkProject,
  modifiedGeneratedFiles,
  readManifest,
} from "../integrations/manifest";

let cwd: string;

function writeInstalledPackage(name: string, version: string): void {
  const root = join(cwd, "node_modules", ...name.split("/"));
  mkdirSync(root, { recursive: true });
  writeFileSync(
    join(root, "package.json"),
    `${JSON.stringify({ name, version }, null, 2)}\n`,
  );
}

function fixture(config = "vite.config.ts", node = "24.19.0"): void {
  const language = config.endsWith(".ts") ? "ts" : "js";
  mkdirSync(join(cwd, "src", "routes"), { recursive: true });
  writeFileSync(
    join(cwd, "package.json"),
    `${JSON.stringify(
      {
        name: "sveltekit-calibration-fixture",
        private: true,
        type: "module",
        engines: { node },
        scripts: { build: "vite build" },
        dependencies: {
          svelte: "5.56.10",
          "@sveltejs/kit": "2.70.3",
          "@sveltejs/adapter-node": "5.5.7",
          "@sveltejs/vite-plugin-svelte": "7.3.0",
          vite: "8.2.2",
        },
      },
      null,
      2,
    )}\n`,
  );
  writeFileSync(join(cwd, ".node-version"), `${node}\n`);
  writeFileSync(join(cwd, ".gitignore"), "node_modules/\nbuild/\n.env*.local\n");
  writeFileSync(join(cwd, "src", "routes", "+page.svelte"), "<h1>Ready</h1>\n");
  writeFileSync(
    join(cwd, config),
    "import adapter from '@sveltejs/adapter-node';\nimport { sveltekit } from '@sveltejs/kit/vite';\nimport { defineConfig } from 'vite';\nexport default defineConfig({ plugins: [sveltekit({ compilerOptions: { dev: false }, adapter: adapter() })], define: { __APP_FLAG__: 'true' } });\n",
  );
  writeFileSync(
    join(cwd, "src", `hooks.client.${language}`),
    "export const untouched = 'client';\nexport function handleError(input) { return { message: `client:${input.message}`, code: 'CLIENT' }; }\n",
  );
  writeFileSync(
    join(cwd, "src", `hooks.server.${language}`),
    "export const untouched = 'server';\nexport const handleError = (input) => Promise.resolve({ message: `server:${input.message}`, code: 'SERVER' });\n",
  );
  for (const [name, version] of [
    ["svelte", "5.56.10"],
    ["@sveltejs/kit", "2.70.3"],
    ["@sveltejs/adapter-node", "5.5.7"],
    ["@sveltejs/vite-plugin-svelte", "7.3.0"],
    ["vite", "8.2.2"],
  ] as const) {
    writeInstalledPackage(name, version);
  }
  linkProject(cwd, {
    id: "11111111-1111-4111-8111-111111111111",
    name: "SvelteKit fixture",
  });
}

function snapshot(root: string): Record<string, string> {
  const entries: Record<string, string> = {};
  const visit = (directory: string): void => {
    for (const name of readdirSync(directory).sort()) {
      const path = join(directory, name);
      if (statSync(path).isDirectory()) visit(path);
      else {
        entries[relative(root, path).replaceAll("\\", "/")] =
          readFileSync(path).toString("base64");
      }
    }
  };
  visit(root);
  return entries;
}

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), "volato-sveltekit-"));
});

afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
});

describe("SvelteKit generated integration", () => {
  it.each([
    ["vite.config.ts", "ts"],
    ["vite.config.js", "js"],
  ] as const)(
    "composes client and server hooks for %s without a runtime dependency",
    (config, language) => {
      fixture(config);
      const project = detectErrorsStack(cwd).sveltekit!;

      const result = generateSvelteKitIntegration({
        cwd,
        project,
        dsn: "https://public@api.volato.dev/project",
        ingestToken: "private-upload-token",
      });

      expect(result.outcomes.every((outcome) => outcome.status !== "manual")).toBe(true);
      for (const path of [
        `volato-sveltekit/browser.${language}`,
        `volato-sveltekit/client.${language}`,
        `volato-sveltekit/node.${language}`,
        `volato-sveltekit/server.${language}`,
        "volato-sveltekit/build.mjs",
        "volato-sveltekit/upload-sourcemaps.mjs",
      ]) {
        expect(existsSync(join(cwd, path)), path).toBe(true);
      }
      const client = readFileSync(project.clientHooksPath, "utf8");
      expect(client).toContain("const untouched = 'client'");
      expect(client).toContain("function __volatoApplicationHandleError(input)");
      expect(client).toContain(
        "export const handleError = createVolatoSvelteKitClientHandleError(__volatoApplicationHandleError);",
      );
      const server = readFileSync(project.serverHooksPath, "utf8");
      expect(server).toContain("const untouched = 'server'");
      expect(server).toContain("const __volatoApplicationHandleError = (input) =>");
      expect(server).toContain(
        "export const handleError = createVolatoSvelteKitServerHandleError(__volatoApplicationHandleError);",
      );
      const generatedConfig = readFileSync(project.configPath, "utf8");
      expect(generatedConfig).toContain(
        "export default defineConfig(withVolatoSvelteKit({",
      );
      expect(generatedConfig).toContain("compilerOptions: { dev: false }");
      expect(generatedConfig).toContain("define: { __APP_FLAG__: 'true' }");
      const pkg = JSON.parse(readFileSync(join(cwd, "package.json"), "utf8"));
      expect(pkg.scripts.build).toBe(
        "vite build && node volato-sveltekit/upload-sourcemaps.mjs",
      );
      const env = readFileSync(join(cwd, ".env.local"), "utf8");
      expect(env).toContain("VITE_VOLATO_DSN=https://public@api.volato.dev/project");
      expect(env).toContain("VOLATO_DSN=https://public@api.volato.dev/project");
      expect(env).toContain("VOLATO_INGEST_TOKEN=private-upload-token");
      expect(env).not.toMatch(/NEXT_PUBLIC_VOLATO/);
      const integration =
        readManifest(cwd)?.integrations[ERRORS_SVELTEKIT_INTEGRATION];
      expect(integration?.recipe).toBe("errors-sveltekit");
      expect(modifiedGeneratedFiles(cwd, integration!)).toEqual([]);
      expect(result.generatedFiles).toHaveLength(6);
    },
  );

  it("creates conventional hooks and converges exactly", () => {
    fixture();
    rmSync(join(cwd, "src", "hooks.client.ts"));
    rmSync(join(cwd, "src", "hooks.server.ts"));
    const options = {
      cwd,
      project: detectErrorsStack(cwd).sveltekit!,
      dsn: "https://public@api.volato.dev/project",
      ingestToken: "private-upload-token",
    };

    generateSvelteKitIntegration(options);
    expect(readFileSync(options.project.clientHooksPath, "utf8")).toContain(
      "createVolatoSvelteKitClientHandleError();",
    );
    expect(readFileSync(options.project.serverHooksPath, "utf8")).toContain(
      "createVolatoSvelteKitServerHandleError();",
    );
    const afterFirst = snapshot(cwd);

    const second = generateSvelteKitIntegration({
      ...options,
      project: detectErrorsStack(cwd).sveltekit!,
    });
    expect(second.outcomes.every((outcome) => outcome.status === "skipped")).toBe(true);
    expect(snapshot(cwd)).toEqual(afterFirst);
  });

  it.each([
    ["re-export", "export { applicationHandleError as handleError } from './application';\n"],
    ["wildcard export", "export * from './application';\n"],
    ["aliased local export", "const application = () => ({});\nexport { application as handleError };\n"],
    ["duplicate definition", "export function handleError() { return {}; }\nexport const handleError = () => ({});\n"],
    ["hand-written Volato import", "import { createVolatoSvelteKitClientHandleError } from '../volato-sveltekit/client';\nexport const handleError = () => ({});\n"],
  ])("refuses an ambiguous %s before mutation", (_label, source) => {
    fixture();
    writeFileSync(join(cwd, "src", "hooks.client.ts"), source);
    const project = detectErrorsStack(cwd).sveltekit!;
    const before = snapshot(cwd);

    expect(() =>
      generateSvelteKitIntegration({
        cwd,
        project,
        dsn: "https://public@api.volato.dev/project",
        ingestToken: "private-upload-token",
      }),
    ).toThrowError(/SvelteKit client handleError.*cannot be composed.*no files were modified/i);
    expect(snapshot(cwd)).toEqual(before);
  });

  it("refuses an edited generated helper byte-identically", () => {
    fixture();
    const options = {
      cwd,
      project: detectErrorsStack(cwd).sveltekit!,
      dsn: "https://public@api.volato.dev/project",
      ingestToken: "private-upload-token",
    };
    generateSvelteKitIntegration(options);
    writeFileSync(join(cwd, "volato-sveltekit", "server.ts"), "// application edit\n");
    const before = snapshot(cwd);

    expect(() =>
      generateSvelteKitIntegration({
        ...options,
        project: detectErrorsStack(cwd).sveltekit!,
      }),
    ).toThrowError(/SvelteKit files were edited or deleted/i);
    expect(snapshot(cwd)).toEqual(before);
  });
});
