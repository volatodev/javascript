import { readFileSync, writeFileSync } from "node:fs";
import type {
  BrowserReactProjectShape,
  ViteReactProjectShape,
} from "../commands/init/detect-errors.js";
import type { PatchOutcome } from "../commands/init/patch.js";
import {
  generateBrowserIntegration,
  type GenerateBrowserOptions,
} from "./browser.js";
import { ERRORS_VITE_REACT_INTEGRATION } from "./manifest.js";

export const BROWSER_REACT_RECIPE_VERSION = "3.0.0";
export const VITE_REACT_RECIPE_VERSION = BROWSER_REACT_RECIPE_VERSION;

export type GenerateBrowserReactOptions = Omit<
  GenerateBrowserOptions,
  "project"
> & { project: BrowserReactProjectShape };

export type GenerateViteReactOptions = Omit<
  GenerateBrowserReactOptions,
  "project"
> & { project: ViteReactProjectShape };

function patchReactEntry(
  path: string,
  reactModule: string,
  browserModule: string,
): PatchOutcome {
  const original = readFileSync(path, "utf8");
  if (
    original.includes("initVolatoBrowser") &&
    (original.includes("VolatoBootstrap") ||
      original.includes("VolatoErrorBoundary"))
  ) {
    return {
      path,
      status: "skipped",
      detail: "Volato browser root already composed",
    };
  }
  if (
    original.includes("VolatoBootstrap") ||
    original.includes("VolatoErrorBoundary")
  ) {
    writeFileSync(
      path,
      `import { initVolatoBrowser } from ${JSON.stringify(browserModule)};\ninitVolatoBrowser();\n${original}`,
      "utf8",
    );
    return {
      path,
      status: "updated",
      detail: "initialized browser capture before the existing Volato React root",
    };
  }
  if (/ErrorBoundary/i.test(original)) {
    return {
      path,
      status: "manual",
      detail:
        "existing React Error Boundary detected; call captureBrowserError from its componentDidCatch without replacing its fallback behavior",
    };
  }
  const renderCalls = original.match(/\.render\s*\(/g) ?? [];
  if (renderCalls.length > 1) {
    return {
      path,
      status: "manual",
      detail:
        "multiple React roots detected; compose one VolatoBootstrap for the browser and one VolatoErrorBoundary around each intended root",
    };
  }
  const renderPattern = /(\.render\s*\()\s*([\s\S]+?)(\s*\);\s*)$/;
  if (!renderPattern.test(original)) {
    return {
      path,
      status: "manual",
      detail:
        "compose VolatoBootstrap and VolatoErrorBoundary around the existing React root",
    };
  }
  const imports =
    `import { initVolatoBrowser } from ${JSON.stringify(browserModule)};\n` +
    `import { VolatoBootstrap, VolatoErrorBoundary } from ${JSON.stringify(reactModule)};\n`;
  const next = `${imports}initVolatoBrowser();\n${original.replace(
    renderPattern,
    "$1\n  <>\n    <VolatoBootstrap />\n    <VolatoErrorBoundary>\n      $2\n    </VolatoErrorBoundary>\n  </>$3",
  )}`;
  writeFileSync(path, next, "utf8");
  return {
    path,
    status: "updated",
    detail: "composed browser capture at the React root",
  };
}

export function generateBrowserReactIntegration(
  options: GenerateBrowserReactOptions,
): ReturnType<typeof generateBrowserIntegration> {
  return generateBrowserIntegration(options, {
    integrationId: ERRORS_VITE_REACT_INTEGRATION,
    recipe: "errors-browser-react",
    recipeVersion: BROWSER_REACT_RECIPE_VERSION,
    label: "React",
    runtime: { ts: "react.tsx", js: "react.jsx" },
    patchEntry: ({ project, rendererModule, browserModule }) => [
      patchReactEntry(project.entryPath, rendererModule, browserModule),
    ],
  });
}

export function generateViteReactIntegration(
  options: GenerateViteReactOptions,
): ReturnType<typeof generateBrowserReactIntegration> {
  return generateBrowserReactIntegration(options);
}
