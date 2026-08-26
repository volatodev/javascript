import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative } from "node:path";
import type {
  BrowserReactProjectShape,
  ViteReactProjectShape,
} from "../commands/init/detect-errors.js";
import { BROWSER_JAVASCRIPT_RUNTIME } from "../generated/browser-javascript-runtime.js";
import {
  patchEnvValues,
  type PatchOutcome,
} from "../commands/init/patch.js";
import {
  createGeneratedIntegration,
  ERRORS_VITE_REACT_INTEGRATION,
  modifiedGeneratedFiles,
  readManifest,
  writeIntegration,
} from "./manifest.js";

export const BROWSER_REACT_RECIPE_VERSION = "3.0.0";
export const VITE_REACT_RECIPE_VERSION = BROWSER_REACT_RECIPE_VERSION;

export type GenerateBrowserReactOptions = {
  cwd: string;
  dsn: string;
  ingestToken?: string;
  project: BrowserReactProjectShape;
  sourceRoot?: string;
};

export type GenerateViteReactOptions = Omit<
  GenerateBrowserReactOptions,
  "project"
> & { project: ViteReactProjectShape };

function assetsRoot(): string {
  const packaged = join(
    __dirname,
    "..",
    "skills",
    "volato-vite-react",
    "assets",
    "runtime",
  );
  if (existsSync(packaged)) return packaged;
  return join(
    __dirname,
    "..",
    "..",
    "skills",
    "volato-vite-react",
    "assets",
    "runtime",
  );
}

function buildRuntimeNames(project: BrowserReactProjectShape): string[] {
  const config = project.buildConfigPath;
  if (project.buildAdapter === "vite") {
    if (/\.mjs$/.test(config)) return ["artifact.mjs", "vite.mjs"];
    if (/\.js$/.test(config)) return ["artifact.js", "vite.js"];
    return ["artifact.ts", "vite.ts"];
  }
  if (project.buildAdapter === "webpack") {
    return /\.cjs$/.test(config)
      ? ["webpack.cjs"]
      : ["artifact.mjs", "webpack.mjs"];
  }
  return /\.mjs$/.test(config)
    ? ["artifact.mjs", "rspack.mjs"]
    : ["artifact.ts", "rspack.ts"];
}

function copyRuntime(
  sourceRoot: string,
  targetRoot: string,
  project: BrowserReactProjectShape,
): string[] {
  const browserNames =
    project.language === "js"
      ? ["browser.js", "react.jsx"]
      : ["browser.ts", "react.tsx"];
  return [...browserNames, ...buildRuntimeNames(project)].map((name) => {
    const target = join(targetRoot, name);
    mkdirSync(dirname(target), { recursive: true });
    const generated = BROWSER_JAVASCRIPT_RUNTIME[name];
    if (generated !== undefined) {
      writeFileSync(target, generated, "utf8");
    } else {
      writeFileSync(target, readFileSync(join(sourceRoot, name)));
    }
    return target;
  });
}

function modulePath(fromFile: string, target: string): string {
  let path = relative(dirname(fromFile), target).replaceAll("\\", "/");
  if (!path.startsWith(".")) path = `./${path}`;
  return path;
}

function patchReactEntry(
  path: string,
  reactModule: string,
  browserModule: string,
): PatchOutcome {
  const original = readFileSync(path, "utf8");
  if (
    original.includes("initVolatoBrowser") &&
    (original.includes("VolatoBootstrap") || original.includes("VolatoErrorBoundary"))
  ) {
    return { path, status: "skipped", detail: "Volato browser root already composed" };
  }
  if (original.includes("VolatoBootstrap") || original.includes("VolatoErrorBoundary")) {
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
  const importLines =
    `import { initVolatoBrowser } from ${JSON.stringify(browserModule)};\n` +
    `import { VolatoBootstrap, VolatoErrorBoundary } from ${JSON.stringify(reactModule)};\n`;
  const next = `${importLines}initVolatoBrowser();\n${original.replace(
    renderPattern,
    "$1\n  <>\n    <VolatoBootstrap />\n    <VolatoErrorBoundary>\n      $2\n    </VolatoErrorBoundary>\n  </>$3",
  )}`;
  writeFileSync(path, next, "utf8");
  return { path, status: "updated", detail: "composed browser capture at the React root" };
}

function patchViteConfig(path: string, viteModule: string): PatchOutcome {
  const original = readFileSync(path, "utf8");
  if (original.includes("withVolato")) {
    return { path, status: "skipped", detail: "Vite build already wrapped with Volato" };
  }
  const exportPattern = /export default\s+(defineConfig\([\s\S]*\));\s*$/;
  if (!exportPattern.test(original)) {
    return {
      path,
      status: "manual",
      detail:
        "Vite config export is dynamic; wrap its resolved UserConfig with withVolato while preserving existing plugins",
    };
  }
  const importLine = `import { withVolato } from ${JSON.stringify(viteModule)};\n`;
  const next = `${importLine}${original.replace(exportPattern, "export default withVolato($1);\n")}`;
  writeFileSync(path, next, "utf8");
  return { path, status: "updated", detail: "enabled release identity and privacy-cleaned sourcemaps" };
}

function patchWebpackConfig(path: string, webpackModule: string): PatchOutcome {
  const original = readFileSync(path, "utf8");
  if (original.includes("withVolatoWebpack")) {
    return { path, status: "skipped", detail: "Webpack build already wrapped with Volato" };
  }
  if (path.endsWith(".cjs")) {
    const exportPattern = /module\.exports\s*=\s*({[\s\S]*});?\s*$/;
    if (!exportPattern.test(original)) {
      return {
        path,
        status: "manual",
        detail:
          "Webpack CommonJS config is dynamic; wrap its resolved Configuration with withVolatoWebpack",
      };
    }
    const requireLine = `const { withVolatoWebpack } = require(${JSON.stringify(webpackModule)});\n`;
    writeFileSync(
      path,
      `${requireLine}${original.replace(exportPattern, "module.exports = withVolatoWebpack($1);\n")}`,
      "utf8",
    );
  } else {
    const exportPattern = /export default\s+({[\s\S]*});?\s*$/;
    if (!exportPattern.test(original)) {
      return {
        path,
        status: "manual",
        detail:
          "Webpack ESM config is dynamic; wrap its resolved Configuration with withVolatoWebpack",
      };
    }
    const importLine = `import { withVolatoWebpack } from ${JSON.stringify(webpackModule)};\n`;
    writeFileSync(
      path,
      `${importLine}${original.replace(exportPattern, "export default withVolatoWebpack($1);\n")}`,
      "utf8",
    );
  }
  return {
    path,
    status: "updated",
    detail: "enabled Webpack release identity and private sourcemaps",
  };
}

function patchRspackConfig(path: string, rspackModule: string): PatchOutcome {
  const original = readFileSync(path, "utf8");
  if (original.includes("withVolatoRspack")) {
    return { path, status: "skipped", detail: "Rspack build already wrapped with Volato" };
  }
  const exportPattern =
    /export default\s+((?:defineConfig\([\s\S]*\))|(?:{[\s\S]*}));?\s*$/;
  if (!exportPattern.test(original)) {
    return {
      path,
      status: "manual",
      detail:
        "Rspack config is dynamic; wrap its resolved Configuration with withVolatoRspack",
    };
  }
  const importLine = `import { withVolatoRspack } from ${JSON.stringify(rspackModule)};\n`;
  writeFileSync(
    path,
    `${importLine}${original.replace(exportPattern, "export default withVolatoRspack($1);\n")}`,
    "utf8",
  );
  return {
    path,
    status: "updated",
    detail: "enabled Rspack release identity and private sourcemaps",
  };
}

function buildHelperName(project: BrowserReactProjectShape): string {
  return buildRuntimeNames(project).at(-1)!;
}

function patchBuildConfig(
  project: BrowserReactProjectShape,
  runtimeRoot: string,
): PatchOutcome {
  const helper = join(runtimeRoot, buildHelperName(project));
  let helperModule = modulePath(project.buildConfigPath, helper);
  if (!/\.[cm]js$/.test(helper)) helperModule = helperModule.replace(/\.[jt]s$/, "");
  if (project.buildAdapter === "vite") {
    return patchViteConfig(project.buildConfigPath, helperModule);
  }
  if (project.buildAdapter === "webpack") {
    return patchWebpackConfig(project.buildConfigPath, helperModule);
  }
  return patchRspackConfig(project.buildConfigPath, helperModule);
}

function assertStaticBuildConfig(project: BrowserReactProjectShape): void {
  const source = readFileSync(project.buildConfigPath, "utf8");
  if (/withVolato(?:Webpack|Rspack)?/.test(source)) return;
  const supported =
    project.buildAdapter === "vite"
      ? /export default\s+defineConfig\([\s\S]*\);?\s*$/.test(source)
      : project.buildAdapter === "webpack"
        ? project.buildConfigPath.endsWith(".cjs")
          ? /module\.exports\s*=\s*{[\s\S]*};?\s*$/.test(source)
          : /export default\s+{[\s\S]*};?\s*$/.test(source)
        : /export default\s+(?:defineConfig\([\s\S]*\)|{[\s\S]*});?\s*$/.test(
            source,
          );
  if (!supported) {
    const label =
      project.buildAdapter === "vite"
        ? "Vite"
        : project.buildAdapter === "webpack"
          ? "Webpack"
          : "Rspack";
    throw new Error(
      `Dynamic ${label} config is not automatically composable. Export one static supported configuration or wrap its resolved config explicitly; no files were modified.`,
    );
  }
}

export function generateBrowserReactIntegration(
  options: GenerateBrowserReactOptions,
): { outcomes: PatchOutcome[]; runtimeRoot: string; generatedFiles: string[]; manifestPath: string } {
  const manifest = readManifest(options.cwd);
  if (!manifest) {
    throw new Error(
      "This repository is not connected to Volato. Run `volato init --project <id>` first.",
    );
  }
  const previous = manifest.integrations[ERRORS_VITE_REACT_INTEGRATION];
  if (previous) {
    const modified = modifiedGeneratedFiles(options.cwd, previous);
    if (modified.length > 0) {
      throw new Error(
        `Generated Volato browser files were edited or deleted: ${modified.join(", ")}. Review those changes before updating the integration.`,
      );
    }
  }

  assertStaticBuildConfig(options.project);

  const sourceRoot = options.sourceRoot ?? assetsRoot();
  if (!existsSync(sourceRoot)) throw new Error(`Browser + React recipe assets are missing: ${sourceRoot}`);
  const runtimeRoot = join(options.cwd, "src", "volato");
  const generatedFiles = copyRuntime(
    sourceRoot,
    runtimeRoot,
    options.project,
  );
  const outcomes: PatchOutcome[] = [
    patchEnvValues(
      options.cwd,
      [
        {
          key:
            options.project.buildAdapter === "vite"
              ? "VITE_VOLATO_DSN"
              : "VOLATO_DSN",
          value: options.dsn,
        },
        ...(options.ingestToken
          ? [{ key: "VOLATO_INGEST_TOKEN", value: options.ingestToken }]
          : []),
      ],
      options.ingestToken !== undefined,
    ),
    patchReactEntry(
      options.project.entryPath,
      modulePath(options.project.entryPath, join(runtimeRoot, "react")),
      modulePath(options.project.entryPath, join(runtimeRoot, "browser")),
    ),
    patchBuildConfig(options.project, runtimeRoot),
  ];
  const integration = createGeneratedIntegration(options.cwd, {
    recipe: "errors-browser-react",
    recipeVersion: BROWSER_REACT_RECIPE_VERSION,
    files: generatedFiles,
  });
  const manifestPath = writeIntegration(
    options.cwd,
    ERRORS_VITE_REACT_INTEGRATION,
    integration,
  );
  return { outcomes, runtimeRoot, generatedFiles, manifestPath };
}

export function generateViteReactIntegration(
  options: GenerateViteReactOptions,
): ReturnType<typeof generateBrowserReactIntegration> {
  return generateBrowserReactIntegration(options);
}
