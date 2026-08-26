import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative } from "node:path";
import type {
  SourceLanguage,
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

export const VITE_REACT_RECIPE_VERSION = "2.0.0";

export type GenerateViteReactOptions = {
  cwd: string;
  dsn: string;
  ingestToken?: string;
  project: ViteReactProjectShape;
  sourceRoot?: string;
};

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

function filesUnder(root: string): string[] {
  return readdirSync(root)
    .flatMap((name) => {
      const path = join(root, name);
      return statSync(path).isDirectory() ? filesUnder(path) : [path];
    })
    .filter((path) => /\.(?:ts|tsx)$/.test(path))
    .sort();
}

function copyRuntime(
  sourceRoot: string,
  targetRoot: string,
  language: SourceLanguage,
): string[] {
  if (language === "js") {
    return Object.entries(BROWSER_JAVASCRIPT_RUNTIME).map(([name, contents]) => {
      const target = join(targetRoot, name);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, contents, "utf8");
      return target;
    });
  }
  return filesUnder(sourceRoot).map((path) => {
    const target = join(targetRoot, relative(sourceRoot, path));
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, readFileSync(path));
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
  browserModule: string,
): PatchOutcome {
  const original = readFileSync(path, "utf8");
  if (original.includes("VolatoBootstrap") || original.includes("VolatoErrorBoundary")) {
    return { path, status: "skipped", detail: "Volato browser root already composed" };
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
  const importLine = `import { VolatoBootstrap, VolatoErrorBoundary } from ${JSON.stringify(browserModule)};\n`;
  const next = `${importLine}${original.replace(
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

export function generateViteReactIntegration(
  options: GenerateViteReactOptions,
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
        `Generated Volato Vite files were edited or deleted: ${modified.join(", ")}. Review those changes before updating the integration.`,
      );
    }
  }

  const sourceRoot = options.sourceRoot ?? assetsRoot();
  if (!existsSync(sourceRoot)) throw new Error(`Vite + React recipe assets are missing: ${sourceRoot}`);
  const runtimeRoot = join(options.cwd, "src", "volato");
  const generatedFiles = copyRuntime(
    sourceRoot,
    runtimeRoot,
    options.project.language,
  );
  const outcomes: PatchOutcome[] = [
    patchEnvValues(
      options.cwd,
      [
        { key: "VITE_VOLATO_DSN", value: options.dsn },
        ...(options.ingestToken
          ? [{ key: "VOLATO_INGEST_TOKEN", value: options.ingestToken }]
          : []),
      ],
      options.ingestToken !== undefined,
    ),
    patchReactEntry(
      options.project.entryPath,
      modulePath(options.project.entryPath, join(runtimeRoot, "react")),
    ),
    patchViteConfig(
      options.project.viteConfigPath,
      modulePath(options.project.viteConfigPath, join(runtimeRoot, "vite")),
    ),
  ];
  const integration = createGeneratedIntegration(options.cwd, {
    recipe: "errors-vite-react",
    recipeVersion: VITE_REACT_RECIPE_VERSION,
    files: generatedFiles,
  });
  const manifestPath = writeIntegration(
    options.cwd,
    ERRORS_VITE_REACT_INTEGRATION,
    integration,
  );
  return { outcomes, runtimeRoot, generatedFiles, manifestPath };
}
