import {
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
import { generateViteSvelteIntegration } from "../integrations/vite-svelte";
import {
  ERRORS_BROWSER_SVELTE_INTEGRATION,
  linkProject,
  modifiedGeneratedFiles,
  readManifest,
} from "../integrations/manifest";

let cwd: string;

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), "volato-svelte-"));
  mkdirSync(join(cwd, "src"));
  writeFileSync(
    join(cwd, "package.json"),
    `${JSON.stringify({
      name: "svelte-fixture",
      type: "module",
      dependencies: {
        svelte: "5.56.10",
        vite: "8.2.2",
        "@sveltejs/vite-plugin-svelte": "7.3.0",
      },
    }, null, 2)}\n`,
  );
  writeFileSync(
    join(cwd, "src", "main.ts"),
    `import { mount } from "svelte";
import App from "./App.svelte";
const app = mount(App, {
  target: document.getElementById("app")!,
  props: { name: "Ada" },
});
export default app;
`,
  );
  writeFileSync(
    join(cwd, "src", "App.svelte"),
    `<script lang="ts">
  let { name }: { name: string } = $props();
</script>

<h1>Hello {name}</h1>

<style>h1 { color: rebeccapurple; }</style>
`,
  );
  writeFileSync(
    join(cwd, "vite.config.ts"),
    'import { defineConfig } from "vite";\nexport default defineConfig({ base: "/app/" });\n',
  );
  linkProject(cwd, {
    id: "11111111-1111-4111-8111-111111111111",
    name: "Svelte fixture",
  });
});

afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
});

describe("Vite + Svelte generated integration", () => {
  it("wraps an export-free root while preserving mount props and source", () => {
    const project = detectErrorsStack(cwd).browserSvelte!;
    const originalRoot = readFileSync(project.rootComponentPath, "utf8");
    const result = generateViteSvelteIntegration({
      cwd,
      project,
      dsn: "https://public@api.volato.dev/project",
    });

    const entry = readFileSync(project.entryPath, "utf8");
    const app = readFileSync(project.rootComponentPath, "utf8");
    const wrapper = readFileSync(
      join(cwd, "src", "volato", "VolatoSvelteRoot.svelte"),
      "utf8",
    );
    expect(entry).toContain('import { initVolatoBrowser } from "./volato/browser";');
    expect(entry).toContain("initVolatoBrowser();");
    expect(entry).toContain('import App from "./volato/VolatoSvelteRoot.svelte";');
    expect(entry).toContain('props: { name: "Ada" }');
    expect(entry).toContain("export default app");
    expect(entry).toContain(
      'const app = mount(App, {\n  target: document.getElementById("app")!,\n  props: { name: "Ada" },\n});',
    );
    expect(app).toBe(originalRoot);
    expect(wrapper).toContain('import OriginalRoot from "../App.svelte";');
    expect(wrapper).toContain("let props = $props()");
    expect(wrapper).toContain("<svelte:boundary onerror={captureVolatoSvelteError}>");
    expect(wrapper).toContain("<OriginalRoot {...props} />");

    const integration = readManifest(cwd)?.integrations[
      ERRORS_BROWSER_SVELTE_INTEGRATION
    ];
    expect(integration?.recipe).toBe("errors-browser-svelte");
    expect(modifiedGeneratedFiles(cwd, integration!)).toEqual([]);
    expect(result.outcomes.every((outcome) => outcome.status !== "manual")).toBe(
      true,
    );
  });

  it("is convergent on a second run", () => {
    generateViteSvelteIntegration({
      cwd,
      project: detectErrorsStack(cwd).browserSvelte!,
      dsn: "https://public@api.volato.dev/project",
    });

    const second = generateViteSvelteIntegration({
      cwd,
      project: detectErrorsStack(cwd).browserSvelte!,
      dsn: "https://public@api.volato.dev/project",
    });
    expect(second.outcomes.every((outcome) => outcome.status === "skipped")).toBe(
      true,
    );
  });
});
