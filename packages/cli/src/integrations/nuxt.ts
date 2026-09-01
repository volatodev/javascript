import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import type { NuxtProjectShape } from "../commands/init/detect-errors.js";
import {
  patchEnvValues,
  type PatchOutcome,
} from "../commands/init/patch.js";
import { BROWSER_JAVASCRIPT_RUNTIME } from "../generated/browser-javascript-runtime.js";
import { NODE_JAVASCRIPT_RUNTIME } from "../generated/node-javascript-runtime.js";
import {
  createGeneratedIntegration,
  ERRORS_NUXT_INTEGRATION,
  modifiedGeneratedFiles,
  readManifest,
  writeIntegration,
} from "./manifest.js";

export const NUXT_RECIPE_VERSION = "0.1.0";
const GENERATED_BUILD =
  "nuxt build && node volato-nuxt/upload-sourcemaps.mjs .output";

export type GenerateNuxtOptions = {
  cwd: string;
  dsn: string;
  ingestToken?: string;
  project: NuxtProjectShape;
  sourceRoot?: string;
};

function nuxtAssetsRoot(): string {
  const packaged = join(
    __dirname,
    "..",
    "skills",
    "volato-nuxt",
    "assets",
    "runtime",
  );
  if (existsSync(packaged)) return packaged;
  return join(
    __dirname,
    "..",
    "..",
    "skills",
    "volato-nuxt",
    "assets",
    "runtime",
  );
}

function sharedBrowserRoot(): string {
  const packaged = join(__dirname, "..", "skills", "_shared", "errors-browser");
  if (existsSync(packaged)) return packaged;
  return join(__dirname, "..", "..", "skills", "_shared", "errors-browser");
}

function sharedNodeRoot(): string {
  const packaged = join(
    __dirname,
    "..",
    "skills",
    "volato-node",
    "assets",
    "runtime",
  );
  if (existsSync(packaged)) return packaged;
  return join(
    __dirname,
    "..",
    "..",
    "skills",
    "volato-node",
    "assets",
    "runtime",
  );
}

function generatedPaths(options: GenerateNuxtOptions): Array<{
  path: string;
  source: string;
}> {
  const extension = options.project.language === "ts" ? "ts" : "js";
  const assets = options.sourceRoot ?? nuxtAssetsRoot();
  const runtimeRoot = join(options.cwd, "volato-nuxt");
  const browser =
    extension === "js"
      ? BROWSER_JAVASCRIPT_RUNTIME["browser.js"]
      : readFileSync(join(sharedBrowserRoot(), "browser.ts"), "utf8");
  const node =
    extension === "js"
      ? NODE_JAVASCRIPT_RUNTIME["node.js"]
      : readFileSync(join(sharedNodeRoot(), "node.ts"), "utf8");
  if (browser === undefined || node === undefined) {
    throw new Error("Generated Nuxt transport assets are missing.");
  }
  return [
    { path: join(runtimeRoot, `browser.${extension}`), source: browser },
    {
      path: join(runtimeRoot, `nuxt-client.${extension}`),
      source: readFileSync(join(assets, `nuxt-client.${extension}`), "utf8"),
    },
    { path: join(runtimeRoot, `node.${extension}`), source: node },
    {
      path: join(runtimeRoot, `nitro.${extension}`),
      source: readFileSync(join(assets, `nitro.${extension}`), "utf8"),
    },
    {
      path: join(
        options.cwd,
        "app",
        "plugins",
        `00.volato-errors.client.${extension}`,
      ),
      source: readFileSync(join(assets, `client-plugin.${extension}`), "utf8"),
    },
    {
      path: join(
        options.cwd,
        "server",
        "plugins",
        `00.volato-errors.${extension}`,
      ),
      source: readFileSync(join(assets, `server-plugin.${extension}`), "utf8"),
    },
    {
      path: join(runtimeRoot, "build.mjs"),
      source: readFileSync(join(assets, "build.mjs"), "utf8"),
    },
    {
      path: join(runtimeRoot, "upload-sourcemaps.mjs"),
      source: readFileSync(join(assets, "upload-sourcemaps.mjs"), "utf8"),
    },
  ];
}

function assertComposable(
  options: GenerateNuxtOptions,
  paths: Array<{ path: string }>,
  hasPrevious: boolean,
): void {
  const config = readFileSync(options.project.configPath, "utf8");
  if (
    !/export\s+default\s+(?:withVolatoNuxt\(\s*)?defineNuxtConfig\(\s*\{[\s\S]*\}\s*\)\s*\)?\s*;?\s*$/.test(
      config,
    )
  ) {
    throw new Error(
      "Nuxt config cannot be composed as one static defineNuxtConfig object; no files were modified.",
    );
  }
  const pkg = JSON.parse(
    readFileSync(join(options.cwd, "package.json"), "utf8"),
  ) as { scripts?: { build?: unknown } };
  if (pkg.scripts?.build !== "nuxt build" && pkg.scripts?.build !== GENERATED_BUILD) {
    throw new Error(
      "Nuxt package build script cannot be composed exactly; no files were modified.",
    );
  }
  if (!hasPrevious) {
    const conflicts = paths.filter(({ path }) => existsSync(path)).map(({ path }) => path);
    if (conflicts.length > 0) {
      throw new Error(
        `Nuxt generated destinations already exist without a Volato manifest: ${conflicts.join(", ")}; no files were modified.`,
      );
    }
  }
}

function patchConfig(project: NuxtProjectShape): PatchOutcome {
  const path = project.configPath;
  const original = readFileSync(path, "utf8");
  if (original.includes("withVolatoNuxt")) {
    return {
      path,
      status: "skipped",
      detail: "Nuxt build already composes the Volato release and maps",
    };
  }
  const exportPattern = /export\s+default\s+(defineNuxtConfig\(\s*\{[\s\S]*\}\s*\))\s*;?\s*$/;
  const importLine = 'import { withVolatoNuxt } from "./volato-nuxt/build.mjs";\n';
  writeFileSync(
    path,
    `${importLine}${original.replace(exportPattern, "export default withVolatoNuxt($1);\n")}`,
    "utf8",
  );
  return {
    path,
    status: "updated",
    detail: "composed one client/server release and private sourcemaps",
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
      detail: "Nuxt sourcemap upload already follows the production build",
    };
  }
  pkg.scripts.build = GENERATED_BUILD;
  writeFileSync(path, `${JSON.stringify(pkg, null, 2)}\n`, "utf8");
  return {
    path,
    status: "updated",
    detail: "uploads and removes private client/server maps after Nuxt build",
  };
}

export function generateNuxtIntegration(options: GenerateNuxtOptions): {
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
  const previous = manifest.integrations[ERRORS_NUXT_INTEGRATION];
  if (previous) {
    const modified = modifiedGeneratedFiles(options.cwd, previous);
    if (modified.length > 0) {
      throw new Error(
        `Generated Volato Nuxt files were edited or deleted: ${modified.join(", ")}. Review those changes before updating the integration.`,
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
    recipe: "errors-nuxt",
    recipeVersion: NUXT_RECIPE_VERSION,
    files: generatedFiles,
  });
  const manifestPath = writeIntegration(
    options.cwd,
    ERRORS_NUXT_INTEGRATION,
    integration,
  );
  return {
    outcomes,
    runtimeRoot: join(options.cwd, "volato-nuxt"),
    generatedFiles,
    manifestPath,
  };
}
