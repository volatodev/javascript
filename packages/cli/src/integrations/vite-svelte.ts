import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
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

type SvelteRootParts = {
  leadingScripts: string;
  markup: string;
  trailingStyles: string;
};

function svelteRootParts(source: string): SvelteRootParts {
  if (
    /<svelte:boundary\b/.test(source) &&
    !source.includes("captureVolatoSvelteError")
  ) {
    throw new Error(
      "An existing Svelte boundary requires explicit fallback/reset composition; no files were modified.",
    );
  }
  if (/<svelte:(?:head|window|body|document|options)\b/.test(source)) {
    throw new Error(
      "A root-level Svelte special element requires explicit boundary placement; no files were modified.",
    );
  }
  const leadingScripts =
    /^(?:\s*<script\b[^>]*>[\s\S]*?<\/script>\s*)*/.exec(source)?.[0] ?? "";
  const afterScripts = source.slice(leadingScripts.length);
  const trailingStyles =
    /(?:\s*<style\b[^>]*>[\s\S]*?<\/style>\s*)*$/.exec(afterScripts)?.[0] ??
    "";
  const markup = afterScripts.slice(0, afterScripts.length - trailingStyles.length);
  if (!markup.trim() || /<(?:script|style)\b/.test(markup)) {
    throw new Error(
      "The Svelte root must keep scripts before markup and styles after markup; no files were modified.",
    );
  }
  return { leadingScripts, markup, trailingStyles };
}

function patchSvelteEntry(
  project: ViteSvelteProjectShape,
  browserModule: string,
): PatchOutcome {
  const path = project.entryPath;
  const original = readFileSync(path, "utf8");
  if (original.includes("initVolatoBrowser")) {
    return {
      path,
      status: "skipped",
      detail: "Volato browser capture already initialized",
    };
  }
  writeFileSync(
    path,
    `import { initVolatoBrowser } from ${JSON.stringify(browserModule)};\ninitVolatoBrowser();\n${original}`,
    "utf8",
  );
  return {
    path,
    status: "updated",
    detail: "initialized browser capture without changing the Svelte mount",
  };
}

function patchSvelteRoot(
  project: ViteSvelteProjectShape,
  svelteModule: string,
): PatchOutcome {
  const path = project.rootComponentPath;
  const original = readFileSync(path, "utf8");
  if (
    original.includes("captureVolatoSvelteError") &&
    /<svelte:boundary\s+onerror=\{captureVolatoSvelteError\}>/.test(original)
  ) {
    return {
      path,
      status: "skipped",
      detail: "Volato Svelte boundary already composed",
    };
  }
  const { leadingScripts, markup, trailingStyles } = svelteRootParts(original);
  const importLine = `import { captureVolatoSvelteError } from ${JSON.stringify(svelteModule)};`;
  const instanceScript = /<script(?![^>]*(?:\bmodule\b|context=["']module["']))[^>]*>/;
  const scripts = instanceScript.test(leadingScripts)
    ? leadingScripts.replace(instanceScript, (opening) => `${opening}\n  ${importLine}`)
    : `<script>\n  ${importLine}\n</script>\n${leadingScripts}`;
  const next = `${scripts}<svelte:boundary onerror={captureVolatoSvelteError}>\n${markup.trim()}\n</svelte:boundary>\n${trailingStyles.replace(/^\s+/, "")}`;
  writeFileSync(path, next, "utf8");
  return {
    path,
    status: "updated",
    detail: "composed a Svelte render/effect boundary around root markup",
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
      svelteRootParts(
        readFileSync((project as ViteSvelteProjectShape).rootComponentPath, "utf8"),
      );
    },
    patchEntry: ({ project, runtimeRoot, browserModule }) => {
      const svelte = project as ViteSvelteProjectShape;
      return [
        patchSvelteEntry(svelte, browserModule),
        patchSvelteRoot(
          svelte,
          browserModulePath(svelte.rootComponentPath, join(runtimeRoot, "svelte")),
        ),
      ];
    },
  });
}
