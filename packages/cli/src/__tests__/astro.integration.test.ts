import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { detectErrorsStack } from "../commands/init/detect-errors";
import { installSkills } from "../commands/skills";
import { generateAstroIntegration } from "../integrations/astro";
import {
  ERRORS_ASTRO_INTEGRATION,
  linkProject,
  modifiedGeneratedFiles,
  readManifest,
} from "../integrations/manifest";

type Renderer = "core" | "react" | "vue" | "svelte";

const rendererPackages = {
  react: ["@astrojs/react", "6.0.4", "react", "19.2.8"],
  vue: ["@astrojs/vue", "7.0.2", "vue", "3.5.42"],
  svelte: ["@astrojs/svelte", "9.0.1", "svelte", "5.56.10"],
} as const;

let cwd: string;

function installPackage(name: string, version: string): void {
  const root = join(cwd, "node_modules", ...name.split("/"));
  mkdirSync(root, { recursive: true });
  writeFileSync(
    join(root, "package.json"),
    `${JSON.stringify({ name, version, type: "module", main: "index.js" })}\n`,
  );
  writeFileSync(join(root, "index.js"), "export default () => ({});\n");
}

function fixture(options: {
  renderer?: Renderer;
  language?: "ts" | "js";
  node?: "22.23.2" | "24.19.0";
  output?: "server" | "static";
  adapterMode?: "standalone" | "middleware";
  config?: string;
  extraDependencies?: Record<string, string>;
} = {}): void {
  const renderer = options.renderer ?? "core";
  const language = options.language ?? "ts";
  const node = options.node ?? "24.19.0";
  const output = options.output ?? "server";
  const adapterMode = options.adapterMode ?? "standalone";
  const dependencies: Record<string, string> = {
    astro: "7.2.9",
    "@astrojs/node": "11.1.4",
    vite: "8.2.2",
    ...(options.extraDependencies ?? {}),
  };
  let rendererImport = "";
  let integrations = "[]";
  if (renderer !== "core") {
    const [integration, integrationVersion, runtime, runtimeVersion] =
      rendererPackages[renderer];
    dependencies[integration] = integrationVersion;
    dependencies[runtime] = runtimeVersion;
    if (renderer === "react") {
      dependencies["react-dom"] = "19.2.8";
      dependencies["@vitejs/plugin-react"] = "5.2.0";
    } else if (renderer === "vue") {
      dependencies["@vitejs/plugin-vue"] = "6.0.8";
    } else {
      dependencies["@sveltejs/vite-plugin-svelte"] = "7.3.0";
      dependencies.typescript = "5.9.3";
    }
    rendererImport = `import ${renderer} from ${JSON.stringify(integration)};\n`;
    integrations = `[${renderer}()]`;
  }
  writeFileSync(
    join(cwd, "package.json"),
    `${JSON.stringify({
      name: "astro-private-calibration",
      type: "module",
      engines: { node },
      scripts: { build: "astro build" },
      dependencies,
    })}\n`,
  );
  writeFileSync(join(cwd, ".node-version"), `${node}\n`);
  writeFileSync(join(cwd, ".gitignore"), "node_modules/\ndist/\n.env*.local\n");
  writeFileSync(
    join(cwd, "astro.config.mjs"),
    options.config ??
      `import { defineConfig } from "astro/config";\nimport node from "@astrojs/node";\n${rendererImport}export default defineConfig({ output: ${JSON.stringify(output)}, adapter: node({ mode: ${JSON.stringify(adapterMode)} }), integrations: ${integrations} });\n`,
  );
  mkdirSync(join(cwd, "src", "pages"), { recursive: true });
  writeFileSync(join(cwd, "src", "pages", "index.astro"), "<h1>Astro</h1>\n");
  writeFileSync(join(cwd, "src", `client.${language}`), "export const answer = 42;\n");
  for (const [name, version] of Object.entries(dependencies)) {
    installPackage(name, version);
  }
  linkProject(cwd, {
    id: "18181818-1818-4818-8818-181818181818",
    name: "Astro fixture",
  });
}

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), "volato-astro-"));
});

afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
});

describe("Astro standalone-node detection", () => {
  it.each([
    ["core", "ts", "22.23.2"],
    ["react", "js", "22.23.2"],
    ["vue", "ts", "24.19.0"],
    ["svelte", "js", "24.19.0"],
  ] as const)("selects %s/%s on Node %s before generic Vite", (renderer, language, node) => {
    fixture({ renderer, language, node });

    const stack = detectErrorsStack(cwd);

    expect(stack.astro).toMatchObject({
      cwd,
      configPath: join(cwd, "astro.config.mjs"),
      language,
      nodeVersion: node,
      astroVersion: "7.2.9",
      adapterNodeVersion: "11.1.4",
      viteVersion: "8.2.2",
      renderer,
      outputRoot: join(cwd, "dist"),
    });
    expect(stack.browserReact).toBeUndefined();
    expect(stack.browserVue).toBeUndefined();
    expect(stack.browserSvelte).toBeUndefined();
    expect(stack.node).toBeUndefined();
  });

  it.each([
    ["static output", { output: "static" }, /static.*outside.*standalone Node/i],
    ["middleware mode", { adapterMode: "middleware" }, /middleware mode.*outside/i],
    ["Astro drift", { extraDependencies: { astro: "7.2.8" } }, /Astro 7\.2\.8.*requires 7\.2\.9/i],
    ["mixed renderers", { renderer: "react", extraDependencies: { "@astrojs/vue": "7.0.2", vue: "3.5.42" } }, /multiple Astro renderers/i],
  ])("refuses %s before mutation", (_label, options, expected) => {
    fixture(options as Parameters<typeof fixture>[0]);
    const before = readFileSync(join(cwd, "astro.config.mjs"), "utf8");

    expect(() => detectErrorsStack(cwd)).toThrowError(expected as RegExp);
    expect(readFileSync(join(cwd, "astro.config.mjs"), "utf8")).toBe(before);
  });

  it.each([
    ["Actions", "src/actions/index.ts", "export const server = {};\n", /Actions.*outside/i],
    ["prerender", "src/pages/index.astro", "---\nexport const prerender = true;\n---\n", /prerender.*outside/i],
    ["client:visible", "src/pages/index.astro", "<Widget client:visible />\n", /client:load/i],
  ])("refuses %s lifecycle evidence", (_label, relativePath, source, expected) => {
    fixture({ renderer: "react" });
    const path = join(cwd, relativePath);
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, source);

    expect(() => detectErrorsStack(cwd)).toThrowError(expected);
  });

  it("installs the supported Astro skill only after exact detection", () => {
    fixture({ renderer: "core" });

    const outcomes = installSkills({
      cwd,
      sourceRoot: fileURLToPath(new URL("../../skills", import.meta.url)),
    });

    expect(outcomes.at(-1)).toMatchObject({
      skill: "volato-astro",
      status: "created",
    });
    expect(
      readFileSync(
        join(cwd, ".agents", "skills", "volato-astro", "SKILL.md"),
        "utf8",
      ),
    ).toContain("supported Astro integration");
  });
});

describe("Astro generated integration", () => {
  it.each(["core", "react", "vue", "svelte"] as const)(
    "generates one dependency-free %s composition and converges",
    (renderer) => {
      fixture({ renderer });
      const beforePackage = JSON.parse(readFileSync(join(cwd, "package.json"), "utf8"));
      const project = detectErrorsStack(cwd).astro!;
      const options = {
        cwd,
        project,
        dsn: "https://public@api.volato.dev/project",
        ingestToken: "private-upload-token",
      };

      const result = generateAstroIntegration(options);

      expect(result.outcomes.every((outcome) => outcome.status !== "manual")).toBe(true);
      for (const path of [
        "browser.mjs",
        "node.mjs",
        "client.mjs",
        "middleware.mjs",
        "vue-client.mjs",
        "vue-app.mjs",
        "build.mjs",
        "upload-sourcemaps.mjs",
      ]) {
        expect(join(cwd, "volato-astro", path)).toSatisfy((value: string) =>
          readFileSync(value, "utf8").length > 0,
        );
      }
      const config = readFileSync(project.configPath, "utf8");
      expect(config).toContain(
        'import { withVolatoAstro } from "./volato-astro/build.mjs";',
      );
      expect(config).toMatch(/export default withVolatoAstro\(defineConfig\(\{/);
      expect(config.indexOf(`${renderer === "core" ? "integrations: []" : `integrations: [${renderer}(`}`)).toBeGreaterThan(-1);
      if (renderer === "vue") {
        expect(config).toContain(
          'vue({ appEntrypoint: "./volato-astro/vue-app.mjs" })',
        );
      }
      const pkg = JSON.parse(readFileSync(join(cwd, "package.json"), "utf8"));
      expect(pkg.dependencies).toEqual(beforePackage.dependencies);
      expect(pkg.scripts.build).toBe(
        "astro build && node volato-astro/upload-sourcemaps.mjs",
      );
      const env = readFileSync(join(cwd, ".env.local"), "utf8");
      expect(env).toContain("VITE_VOLATO_DSN=https://public@api.volato.dev/project");
      expect(env).toContain("VOLATO_DSN=https://public@api.volato.dev/project");
      expect(env).toContain("VOLATO_INGEST_TOKEN=private-upload-token");
      expect(env).not.toMatch(/NEXT_PUBLIC_VOLATO/);
      const integration = readManifest(cwd)?.integrations[ERRORS_ASTRO_INTEGRATION];
      expect(integration?.recipe).toBe("errors-astro");
      expect(modifiedGeneratedFiles(cwd, integration!)).toEqual([]);
      expect(result.generatedFiles).toHaveLength(8);

      const afterFirst = Object.fromEntries(
        result.generatedFiles.map((path) => [path, readFileSync(path, "utf8")]),
      );
      const second = generateAstroIntegration({
        ...options,
        project: detectErrorsStack(cwd).astro!,
      });
      expect(second.outcomes.every((outcome) => outcome.status === "skipped")).toBe(true);
      expect(
        Object.fromEntries(
          result.generatedFiles.map((path) => [path, readFileSync(path, "utf8")]),
        ),
      ).toEqual(afterFirst);
    },
  );

  it("refuses an edited generated runtime before changing anything else", () => {
    fixture();
    const options = {
      cwd,
      project: detectErrorsStack(cwd).astro!,
      dsn: "https://public@api.volato.dev/project",
      ingestToken: "private-upload-token",
    };
    generateAstroIntegration(options);
    writeFileSync(join(cwd, "volato-astro", "middleware.mjs"), "// application edit\n");
    const config = readFileSync(options.project.configPath, "utf8");

    expect(() =>
      generateAstroIntegration({
        ...options,
        project: detectErrorsStack(cwd).astro!,
      }),
    ).toThrowError(/Astro files were edited or deleted/i);
    expect(readFileSync(options.project.configPath, "utf8")).toBe(config);
  });
});
