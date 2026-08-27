import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative } from "node:path";
import type { BrowserProjectShape } from "../commands/init/detect-errors.js";
import { BROWSER_JAVASCRIPT_RUNTIME } from "../generated/browser-javascript-runtime.js";
import {
  patchEnvValues,
  type PatchOutcome,
} from "../commands/init/patch.js";
import {
  createGeneratedIntegration,
  type IntegrationId,
  modifiedGeneratedFiles,
  readManifest,
  writeIntegration,
} from "./manifest.js";

export type GenerateBrowserOptions = {
  cwd: string;
  dsn: string;
  ingestToken?: string;
  project: BrowserProjectShape;
  sourceRoot?: string;
};

export type BrowserRendererRecipe = {
  integrationId: IntegrationId;
  recipe: string;
  recipeVersion: string;
  label: string;
  runtime: { ts: string; js: string };
  patchEntry: (options: {
    project: BrowserProjectShape;
    runtimeRoot: string;
    rendererModule: string;
    browserModule: string;
  }) => PatchOutcome[];
  validate?: (project: BrowserProjectShape) => void;
  prepareRuntime?: (options: {
    project: BrowserProjectShape;
    runtimeRoot: string;
  }) => string[];
};

function assetsRoot(): string {
  const packaged = join(
    __dirname,
    "..",
    "skills",
    "_shared",
    "errors-browser",
  );
  if (existsSync(packaged)) return packaged;
  return join(
    __dirname,
    "..",
    "..",
    "skills",
    "_shared",
    "errors-browser",
  );
}

function buildRuntimeNames(project: BrowserProjectShape): string[] {
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
  project: BrowserProjectShape,
  renderer: BrowserRendererRecipe["runtime"],
): string[] {
  const browserNames =
    project.language === "js"
      ? ["browser.js", renderer.js]
      : ["browser.ts", renderer.ts];
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

export function browserModulePath(fromFile: string, target: string): string {
  let path = relative(dirname(fromFile), target).replaceAll("\\", "/");
  if (!path.startsWith(".")) path = `./${path}`;
  return path;
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

function buildHelperName(project: BrowserProjectShape): string {
  return buildRuntimeNames(project).at(-1)!;
}

function patchBuildConfig(
  project: BrowserProjectShape,
  runtimeRoot: string,
): PatchOutcome {
  const helper = join(runtimeRoot, buildHelperName(project));
  let helperModule = browserModulePath(project.buildConfigPath, helper);
  if (!/\.[cm]js$/.test(helper)) helperModule = helperModule.replace(/\.[jt]s$/, "");
  if (project.buildAdapter === "vite") {
    return patchViteConfig(project.buildConfigPath, helperModule);
  }
  if (project.buildAdapter === "webpack") {
    return patchWebpackConfig(project.buildConfigPath, helperModule);
  }
  return patchRspackConfig(project.buildConfigPath, helperModule);
}

function assertStaticBuildConfig(project: BrowserProjectShape): void {
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

export function generateBrowserIntegration(
  options: GenerateBrowserOptions,
  renderer: BrowserRendererRecipe,
): { outcomes: PatchOutcome[]; runtimeRoot: string; generatedFiles: string[]; manifestPath: string } {
  const manifest = readManifest(options.cwd);
  if (!manifest) {
    throw new Error(
      "This repository is not connected to Volato. Run `volato init --project <id>` first.",
    );
  }
  const previous = manifest.integrations[renderer.integrationId];
  if (previous) {
    const modified = modifiedGeneratedFiles(options.cwd, previous);
    if (modified.length > 0) {
      throw new Error(
        `Generated Volato browser files were edited or deleted: ${modified.join(", ")}. Review those changes before updating the integration.`,
      );
    }
  }

  assertStaticBuildConfig(options.project);
  renderer.validate?.(options.project);

  const sourceRoot = options.sourceRoot ?? assetsRoot();
  if (!existsSync(sourceRoot)) {
    throw new Error(`Browser + ${renderer.label} recipe assets are missing: ${sourceRoot}`);
  }
  const runtimeRoot = join(options.cwd, "src", "volato");
  const generatedFiles = copyRuntime(
    sourceRoot,
    runtimeRoot,
    options.project,
    renderer.runtime,
  );
  generatedFiles.push(
    ...(renderer.prepareRuntime?.({
      project: options.project,
      runtimeRoot,
    }) ?? []),
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
    ...renderer.patchEntry({
      project: options.project,
      runtimeRoot,
      rendererModule: browserModulePath(
        options.project.entryPath,
        join(runtimeRoot, renderer.runtime.ts.replace(/\.[^.]+$/, "")),
      ),
      browserModule: browserModulePath(
        options.project.entryPath,
        join(runtimeRoot, "browser"),
      ),
    }),
    patchBuildConfig(options.project, runtimeRoot),
  ];
  const integration = createGeneratedIntegration(options.cwd, {
    recipe: renderer.recipe,
    recipeVersion: renderer.recipeVersion,
    files: generatedFiles,
  });
  const manifestPath = writeIntegration(
    options.cwd,
    renderer.integrationId,
    integration,
  );
  return { outcomes, runtimeRoot, generatedFiles, manifestPath };
}
