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
import { generateViteVueIntegration } from "../integrations/vite-vue";
import {
  ERRORS_BROWSER_VUE_INTEGRATION,
  linkProject,
  modifiedGeneratedFiles,
  readManifest,
} from "../integrations/manifest";

let cwd: string;

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), "volato-vue-"));
  mkdirSync(join(cwd, "src"));
  writeFileSync(
    join(cwd, "package.json"),
    `${JSON.stringify({
      name: "vue-fixture",
      type: "module",
      dependencies: {
        vue: "3.5.42",
        vite: "7.3.6",
        "@vitejs/plugin-vue": "6.0.8",
      },
    }, null, 2)}\n`,
  );
  writeFileSync(
    join(cwd, "src", "main.ts"),
    `import { createApp } from "vue";
import App from "./App.vue";
const app = createApp(App);
app.config.errorHandler = (error, _instance, info) => console.error(info, error);
app.mount("#app");
`,
  );
  writeFileSync(join(cwd, "src", "App.vue"), "<template><main>Ready</main></template>\n");
  writeFileSync(
    join(cwd, "vite.config.ts"),
    'import { defineConfig } from "vite";\nexport default defineConfig({ base: "/console/" });\n',
  );
  linkProject(cwd, {
    id: "11111111-1111-4111-8111-111111111111",
    name: "Vue fixture",
  });
});

afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
});

describe("Vite + Vue generated integration", () => {
  it("composes one Vue root after an existing errorHandler and before mount", () => {
    const project = detectErrorsStack(cwd).browserVue!;
    const result = generateViteVueIntegration({
      cwd,
      project,
      dsn: "https://public@api.volato.dev/project",
    });

    const entry = readFileSync(project.entryPath, "utf8");
    expect(entry).toContain('import { installVolatoVue } from "./volato/vue";');
    expect(entry.indexOf("app.config.errorHandler")).toBeLessThan(
      entry.indexOf("installVolatoVue(app)"),
    );
    expect(entry.indexOf("installVolatoVue(app)")).toBeLessThan(
      entry.indexOf('app.mount("#app")'),
    );
    for (const file of ["browser.ts", "vue.ts", "artifact.ts", "vite.ts"]) {
      expect(existsSync(join(cwd, "src", "volato", file))).toBe(true);
    }
    expect(readFileSync(join(cwd, ".env.local"), "utf8")).toContain(
      "VITE_VOLATO_DSN=https://public@api.volato.dev/project",
    );
    const integration = readManifest(cwd)?.integrations[
      ERRORS_BROWSER_VUE_INTEGRATION
    ];
    expect(integration?.recipe).toBe("errors-browser-vue");
    expect(modifiedGeneratedFiles(cwd, integration!)).toEqual([]);
    expect(result.outcomes.every((outcome) => outcome.status !== "manual")).toBe(
      true,
    );
  });

  it("is convergent on a second run", () => {
    const first = generateViteVueIntegration({
      cwd,
      project: detectErrorsStack(cwd).browserVue!,
      dsn: "https://public@api.volato.dev/project",
    });
    expect(first.outcomes.every((outcome) => outcome.status !== "manual")).toBe(
      true,
    );

    const second = generateViteVueIntegration({
      cwd,
      project: detectErrorsStack(cwd).browserVue!,
      dsn: "https://public@api.volato.dev/project",
    });
    expect(second.outcomes.every((outcome) => outcome.status === "skipped")).toBe(
      true,
    );
  });
});
