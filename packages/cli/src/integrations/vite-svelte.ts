import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import type { ViteSvelteProjectShape } from "../commands/init/detect-errors.js";
import type { PatchOutcome } from "../commands/init/patch.js";
import {
  browserModulePath,
  generateBrowserIntegration,
  type GenerateBrowserOptions,
} from "./browser.js";
import { ERRORS_BROWSER_SVELTE_INTEGRATION } from "./manifest.js";

export const VITE_SVELTE_RECIPE_VERSION = "1.0.0";

export type GenerateViteSvelteOptions = Omit<
  GenerateBrowserOptions,
  "project"
> & { project: ViteSvelteProjectShape };

function assertSvelteRoot(source: string): void {
  if (
    /<svelte:boundary\b/.test(source) &&
    !source.includes("captureVolatoSvelteError")
  ) {
    throw new Error(
      "An existing Svelte boundary requires explicit fallback/reset composition; no files were modified.",
    );
  }
  if (/\bexport\s+(?:let|const|function|class)\b/.test(source)) {
    throw new Error(
      "An exported Svelte component API cannot be preserved by the root boundary wrapper; no files were modified.",
    );
  }
}

function writeSvelteWrapper(
  project: ViteSvelteProjectShape,
  runtimeRoot: string,
): string[] {
  const path = join(runtimeRoot, "VolatoSvelteRoot.svelte");
  if (
    basename(project.rootComponentPath) === "VolatoSvelteRoot.svelte" &&
    existsSync(path)
  ) {
    return [path];
  }
  const rootModule = browserModulePath(path, project.rootComponentPath);
  const captureModule = browserModulePath(path, join(runtimeRoot, "svelte"));
  const language = project.language === "ts" ? ' lang="ts"' : "";
  writeFileSync(
    path,
    `<script${language}>\n  import OriginalRoot from ${JSON.stringify(rootModule)};\n  import { captureVolatoSvelteError } from ${JSON.stringify(captureModule)};\n  let props = $props();\n</script>\n\n<svelte:boundary onerror={captureVolatoSvelteError}>\n  <OriginalRoot {...props} />\n</svelte:boundary>\n`,
    "utf8",
  );
  return [path];
}

function patchSvelteEntry(
  project: ViteSvelteProjectShape,
  browserModule: string,
): PatchOutcome {
  const path = project.entryPath;
  const original = readFileSync(path, "utf8");
  if (
    original.includes("initVolatoBrowser") &&
    original.includes("VolatoSvelteRoot.svelte")
  ) {
    return {
      path,
      status: "skipped",
      detail: "Volato browser capture already initialized",
    };
  }
  const rootImport = new RegExp(
    `(import\\s+${project.rootComponentVariable.replace(/[$]/g, "\\$")}\\s+from\\s+)["'][^"']+\\.svelte["']`,
  );
  if (!rootImport.test(original)) {
    return {
      path,
      status: "manual",
      detail: "the detected Svelte root import is no longer statically composable",
    };
  }
  const wrapperModule = browserModulePath(
    path,
    join(project.cwd, "src", "volato", "VolatoSvelteRoot.svelte"),
  );
  const withWrapper = original.replace(
    rootImport,
    `$1${JSON.stringify(wrapperModule)}`,
  );
  writeFileSync(
    path,
    `import { initVolatoBrowser } from ${JSON.stringify(browserModule)};\ninitVolatoBrowser();\n${withWrapper}`,
    "utf8",
  );
  return {
    path,
    status: "updated",
    detail: "initialized browser capture and mounted the generated Svelte boundary wrapper",
  };
}

export function generateViteSvelteIntegration(
  options: GenerateViteSvelteOptions,
): ReturnType<typeof generateBrowserIntegration> {
  return generateBrowserIntegration(options, {
    integrationId: ERRORS_BROWSER_SVELTE_INTEGRATION,
    recipe: "errors-browser-svelte",
    recipeVersion: VITE_SVELTE_RECIPE_VERSION,
    label: "Svelte",
    runtime: { ts: "svelte.ts", js: "svelte.js" },
    validate: (project) => {
      assertSvelteRoot(
        readFileSync((project as ViteSvelteProjectShape).rootComponentPath, "utf8"),
      );
    },
    prepareRuntime: ({ project, runtimeRoot }) =>
      writeSvelteWrapper(project as ViteSvelteProjectShape, runtimeRoot),
    patchEntry: ({ project, browserModule }) => {
      const svelte = project as ViteSvelteProjectShape;
      return [patchSvelteEntry(svelte, browserModule)];
    },
  });
}
