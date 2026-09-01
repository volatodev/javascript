import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import type { AstroProjectShape } from "../commands/init/detect-errors.js";
import {
  patchEnvValues,
  type PatchOutcome,
} from "../commands/init/patch.js";
import { BROWSER_JAVASCRIPT_RUNTIME } from "../generated/browser-javascript-runtime.js";
import { NODE_JAVASCRIPT_RUNTIME } from "../generated/node-javascript-runtime.js";
import {
  createGeneratedIntegration,
  ERRORS_ASTRO_INTEGRATION,
  modifiedGeneratedFiles,
  readManifest,
  writeIntegration,
} from "./manifest.js";

export const ASTRO_RECIPE_VERSION = "0.1.0";
const GENERATED_BUILD =
  "astro build && node volato-astro/upload-sourcemaps.mjs";

export type GenerateAstroOptions = {
  cwd: string;
  dsn: string;
  ingestToken?: string;
  project: AstroProjectShape;
  sourceRoot?: string;
};

function astroAssetsRoot(): string {
  const packaged = join(
    __dirname,
    "..",
    "skills",
    "volato-astro",
    "assets",
    "runtime",
  );
  if (existsSync(packaged)) return packaged;
  return join(
    __dirname,
    "..",
    "..",
    "skills",
    "volato-astro",
    "assets",
    "runtime",
  );
}

function generatedPaths(options: GenerateAstroOptions): Array<{
  path: string;
  source: string;
}> {
  const assets = options.sourceRoot ?? astroAssetsRoot();
  const runtimeRoot = join(options.cwd, "volato-astro");
  const browser = BROWSER_JAVASCRIPT_RUNTIME["browser.js"];
  const node = NODE_JAVASCRIPT_RUNTIME["node.js"];
  if (browser === undefined || node === undefined) {
    throw new Error("Generated Astro transport assets are missing.");
  }
  return [
    { path: join(runtimeRoot, "browser.mjs"), source: browser },
    { path: join(runtimeRoot, "node.mjs"), source: node },
    ...[
      "client.mjs",
      "middleware.mjs",
      "vue-client.mjs",
      "vue-app.mjs",
      "build.mjs",
      "upload-sourcemaps.mjs",
    ].map((name) => ({
      path: join(runtimeRoot, name),
      source: readFileSync(join(assets, name), "utf8"),
    })),
  ];
}

function assertComposable(
  options: GenerateAstroOptions,
  paths: Array<{ path: string }>,
  hasPrevious: boolean,
): void {
  const config = readFileSync(options.project.configPath, "utf8");
  if (
    !/export\s+default\s+(?:withVolatoAstro\(\s*)?defineConfig\(\s*\{[\s\S]*\}\s*\)\s*\)?\s*;?\s*$/.test(
      config,
    )
  ) {
    throw new Error(
      "Astro config cannot be composed as one static defineConfig object; no files were modified.",
    );
  }
  const pkg = JSON.parse(
    readFileSync(join(options.cwd, "package.json"), "utf8"),
  ) as { scripts?: { build?: unknown } };
  if (
    pkg.scripts?.build !== "astro build" &&
    pkg.scripts?.build !== GENERATED_BUILD
  ) {
    throw new Error(
      "Astro package build script cannot be composed exactly; no files were modified.",
    );
  }
  if (!hasPrevious) {
    const conflicts = paths
      .filter(({ path }) => existsSync(path))
      .map(({ path }) => path);
    if (conflicts.length > 0) {
      throw new Error(
        `Astro generated destinations already exist without a Volato manifest: ${conflicts.join(", ")}; no files were modified.`,
      );
    }
  }
}

function patchConfig(project: AstroProjectShape): PatchOutcome {
  const path = project.configPath;
  const original = readFileSync(path, "utf8");
  if (original.includes("withVolatoAstro")) {
    return {
      path,
      status: "skipped",
      detail: "Astro build already composes Volato capture, release and maps",
    };
  }
  let composed = original;
  if (project.renderer === "vue") {
    composed = composed.replace(
      /\bvue\s*\(\s*\)/,
      'vue({ appEntrypoint: "./volato-astro/vue-app.mjs" })',
    );
  }
  const exportPattern =
    /export\s+default\s+(defineConfig\(\s*\{[\s\S]*\}\s*\))\s*;?\s*$/;
  const importLine =
    'import { withVolatoAstro } from "./volato-astro/build.mjs";\n';
  writeFileSync(
    path,
    `${importLine}${composed.replace(exportPattern, "export default withVolatoAstro($1);\n")}`,
    "utf8",
  );
  return {
    path,
    status: "updated",
    detail: "appended Astro capture and composed one client/server release",
  };
}

function patchBuild(cwd: string): PatchOutcome {
  const path = join(cwd, "package.json");
  const pkg = JSON.parse(readFileSync(path, "utf8")) as {
    scripts: { build: string };
  };
  if (pkg.scripts.build === GENERATED_BUILD) {
    return {
      path,
      status: "skipped",
      detail: "Astro sourcemap upload already follows the production build",
    };
  }
  pkg.scripts.build = GENERATED_BUILD;
  writeFileSync(path, `${JSON.stringify(pkg, null, 2)}\n`, "utf8");
  return {
    path,
    status: "updated",
    detail: "uploads and removes bounded Astro client/server maps after build",
  };
}

export function generateAstroIntegration(options: GenerateAstroOptions): {
  outcomes: PatchOutcome[];
  runtimeRoot: string;
  generatedFiles: string[];
  manifestPath: string;
} {
  const manifest = readManifest(options.cwd);
  if (!manifest) {
    throw new Error(
      "This repository is not connected to Volato. Run `volato init --project <id>` first.",
    );
  }
  const previous = manifest.integrations[ERRORS_ASTRO_INTEGRATION];
  if (previous) {
    const modified = modifiedGeneratedFiles(options.cwd, previous);
    if (modified.length > 0) {
      throw new Error(
        `Generated Volato Astro files were edited or deleted: ${modified.join(", ")}. Review those changes before updating the integration.`,
      );
    }
  }
  const files = generatedPaths(options);
  assertComposable(options, files, previous !== undefined);
  for (const file of files) {
    mkdirSync(dirname(file.path), { recursive: true });
    writeFileSync(file.path, file.source, "utf8");
  }
  const outcomes = [
    patchEnvValues(
      options.cwd,
      [
        { key: "VITE_VOLATO_DSN", value: options.dsn },
        { key: "VOLATO_DSN", value: options.dsn },
        ...(options.ingestToken
          ? [{ key: "VOLATO_INGEST_TOKEN", value: options.ingestToken }]
          : []),
      ],
      options.ingestToken !== undefined,
    ),
    patchConfig(options.project),
    patchBuild(options.cwd),
  ];
  const generatedFiles = files.map(({ path }) => path);
  const integration = createGeneratedIntegration(options.cwd, {
    recipe: "errors-astro",
    recipeVersion: ASTRO_RECIPE_VERSION,
    files: generatedFiles,
  });
  const manifestPath = writeIntegration(
    options.cwd,
    ERRORS_ASTRO_INTEGRATION,
    integration,
  );
  return {
    outcomes,
    runtimeRoot: join(options.cwd, "volato-astro"),
    generatedFiles,
    manifestPath,
  };
}
