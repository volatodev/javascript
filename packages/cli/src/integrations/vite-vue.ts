import { readFileSync, writeFileSync } from "node:fs";
import type { ViteVueProjectShape } from "../commands/init/detect-errors.js";
import type { PatchOutcome } from "../commands/init/patch.js";
import {
  generateBrowserIntegration,
  type GenerateBrowserOptions,
} from "./browser.js";
import { ERRORS_BROWSER_VUE_INTEGRATION } from "./manifest.js";

export const VITE_VUE_RECIPE_VERSION = "1.0.0";

export type GenerateViteVueOptions = Omit<GenerateBrowserOptions, "project"> & {
  project: ViteVueProjectShape;
};

function patchVueEntry(
  project: ViteVueProjectShape,
  vueModule: string,
): PatchOutcome {
  const path = project.entryPath;
  const original = readFileSync(path, "utf8");
  if (original.includes("installVolatoVue")) {
    return {
      path,
      status: "skipped",
      detail: "Volato Vue root already composed",
    };
  }
  const mountPattern = new RegExp(
    `(^|\\n)([ \\t]*)${project.appVariable.replace(/[$]/g, "\\$")}\\.mount\\s*\\(`,
  );
  if (!mountPattern.test(original)) {
    return {
      path,
      status: "manual",
      detail: "the detected Vue root no longer has one static mount call",
    };
  }
  const importLine = `import { installVolatoVue } from ${JSON.stringify(vueModule)};\n`;
  const next = `${importLine}${original.replace(
    mountPattern,
    `$1$2installVolatoVue(${project.appVariable});\n$2${project.appVariable}.mount(`,
  )}`;
  writeFileSync(path, next, "utf8");
  return {
    path,
    status: "updated",
    detail: "composed Vue errorHandler before the application mount",
  };
}

export function generateViteVueIntegration(
  options: GenerateViteVueOptions,
): ReturnType<typeof generateBrowserIntegration> {
  return generateBrowserIntegration(options, {
    integrationId: ERRORS_BROWSER_VUE_INTEGRATION,
    recipe: "errors-browser-vue",
    recipeVersion: VITE_VUE_RECIPE_VERSION,
    label: "Vue",
    runtime: { ts: "vue.ts", js: "vue.js" },
    patchEntry: ({ project, rendererModule }) => [
      patchVueEntry(project as ViteVueProjectShape, rendererModule),
    ],
  });
}
