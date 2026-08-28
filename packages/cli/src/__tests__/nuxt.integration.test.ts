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
import { generateNuxtIntegration } from "../integrations/nuxt";
import {
  ERRORS_NUXT_INTEGRATION,
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

function fixture(config = "nuxt.config.ts", node = "24.19.0"): void {
  mkdirSync(join(cwd, "app"), { recursive: true });
  mkdirSync(join(cwd, "server", "plugins"), { recursive: true });
  writeFileSync(
    join(cwd, "package.json"),
    `${JSON.stringify(
      {
        name: "nuxt-calibration-fixture",
        private: true,
        type: "module",
        engines: { node },
        scripts: { build: "nuxt build" },
        dependencies: {
          nuxt: "4.5.2",
          vue: "3.5.42",
          "vue-router": "5.2.0",
        },
      },
      null,
      2,
    )}\n`,
  );
  writeFileSync(join(cwd, ".node-version"), `${node}\n`);
  writeFileSync(join(cwd, ".gitignore"), "node_modules/\n.output/\n.env*.local\n");
  writeFileSync(join(cwd, "app", "app.vue"), "<template><NuxtPage /></template>\n");
  writeFileSync(
    join(cwd, config),
    "export default defineNuxtConfig({ nitro: { preset: 'node-server', hooks: { close() {} } }, vite: { define: { __APP_FLAG__: 'true' } } });\n",
  );
  writeFileSync(
    join(cwd, "server", "plugins", "existing.ts"),
    "export default defineNitroPlugin((nitroApp) => nitroApp.hooks.hook('error', () => {}));\n",
  );
  for (const [name, version] of [
    ["nuxt", "4.5.2"],
    ["@nuxt/nitro-server", "4.5.2"],
    ["@nuxt/vite-builder", "4.5.2"],
    ["nitropack", "2.13.4"],
    ["vue", "3.5.42"],
    ["vue-router", "5.2.0"],
    ["vite", "8.2.2"],
  ] as const) {
    writeInstalledPackage(name, version);
  }
  linkProject(cwd, {
    id: "11111111-1111-4111-8111-111111111111",
    name: "Nuxt fixture",
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
  cwd = mkdtempSync(join(tmpdir(), "volato-nuxt-"));
});

afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
});

describe("Nuxt/Nitro private generated integration", () => {
  it.each([
    ["nuxt.config.ts", "ts"],
    ["nuxt.config.js", "js"],
    ["nuxt.config.mjs", "js"],
  ] as const)("generates and composes the %s cell without a runtime dependency", (config, language) => {
    fixture(config);
    const project = detectErrorsStack(cwd).nuxt!;
    const existingPlugin = readFileSync(
      join(cwd, "server", "plugins", "existing.ts"),
      "utf8",
    );

    const result = generateNuxtIntegration({
      cwd,
      project,
      dsn: "https://public@api.volato.dev/project",
      ingestToken: "private-upload-token",
    });

    expect(result.outcomes.every((outcome) => outcome.status !== "manual")).toBe(true);
    const extension = language === "ts" ? "ts" : "js";
    for (const path of [
      `volato-nuxt/browser.${extension}`,
      `volato-nuxt/nuxt-client.${extension}`,
      `volato-nuxt/node.${extension}`,
      `volato-nuxt/nitro.${extension}`,
      `app/plugins/00.volato-errors.client.${extension}`,
      `server/plugins/00.volato-errors.${extension}`,
      "volato-nuxt/build.mjs",
      "volato-nuxt/upload-sourcemaps.mjs",
    ]) {
      expect(existsSync(join(cwd, path)), path).toBe(true);
    }
    expect(readFileSync(project.configPath, "utf8")).toContain(
      "export default withVolatoNuxt(defineNuxtConfig(",
    );
    expect(readFileSync(project.configPath, "utf8")).toContain(
      "nitro: { preset: 'node-server', hooks: { close() {} } }",
    );
    expect(
      readFileSync(join(cwd, "server", "plugins", "existing.ts"), "utf8"),
    ).toBe(existingPlugin);
    const pkg = JSON.parse(readFileSync(join(cwd, "package.json"), "utf8"));
    expect(pkg.scripts.build).toBe(
      "nuxt build && node volato-nuxt/upload-sourcemaps.mjs .output",
    );
    const env = readFileSync(join(cwd, ".env.local"), "utf8");
    expect(env).toContain("VITE_VOLATO_DSN=https://public@api.volato.dev/project");
    expect(env).toContain("VOLATO_DSN=https://public@api.volato.dev/project");
    expect(env).toContain("VOLATO_INGEST_TOKEN=private-upload-token");
    expect(env).not.toMatch(/(?:NEXT_PUBLIC|NUXT_PUBLIC)_VOLATO/);
    const integration = readManifest(cwd)?.integrations[ERRORS_NUXT_INTEGRATION];
    expect(integration?.recipe).toBe("errors-nuxt-private");
    expect(modifiedGeneratedFiles(cwd, integration!)).toEqual([]);
    expect(result.generatedFiles).toHaveLength(8);
  });

  it("converges exactly and refuses an edited generated file byte-identically", () => {
    fixture();
    const options = {
      cwd,
      project: detectErrorsStack(cwd).nuxt!,
      dsn: "https://public@api.volato.dev/project",
      ingestToken: "private-upload-token",
    };
    generateNuxtIntegration(options);
    const afterFirst = snapshot(cwd);

    const second = generateNuxtIntegration({
      ...options,
      project: detectErrorsStack(cwd).nuxt!,
    });
    expect(second.outcomes.every((outcome) => outcome.status === "skipped")).toBe(true);
    expect(snapshot(cwd)).toEqual(afterFirst);

    writeFileSync(join(cwd, "volato-nuxt", "nitro.ts"), "// application edit\n");
    const beforeRefusal = snapshot(cwd);
    expect(() =>
      generateNuxtIntegration({
        ...options,
        project: detectErrorsStack(cwd).nuxt!,
      }),
    ).toThrowError(/Nuxt files were edited or deleted/i);
    expect(snapshot(cwd)).toEqual(beforeRefusal);
  });
});
