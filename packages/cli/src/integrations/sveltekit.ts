import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import type { SvelteKitProjectShape } from "../commands/init/detect-errors.js";
import { patchEnvValues, type PatchOutcome } from "../commands/init/patch.js";
import { BROWSER_JAVASCRIPT_RUNTIME } from "../generated/browser-javascript-runtime.js";
import { NODE_JAVASCRIPT_RUNTIME } from "../generated/node-javascript-runtime.js";
import {
  createGeneratedIntegration,
  ERRORS_SVELTEKIT_INTEGRATION,
  modifiedGeneratedFiles,
  readManifest,
  writeIntegration,
} from "./manifest.js";

export const SVELTEKIT_RECIPE_VERSION = "0.1.0";
const GENERATED_BUILD =
  "vite build && node volato-sveltekit/upload-sourcemaps.mjs";

export type GenerateSvelteKitOptions = {
  cwd: string;
  dsn: string;
  ingestToken?: string;
  project: SvelteKitProjectShape;
  sourceRoot?: string;
};

type PlannedHook = {
  path: string;
  source: string;
  status: "created" | "updated" | "skipped";
  detail: string;
};

function assetsRoot(): string {
  const packaged = join(
    __dirname,
    "..",
    "skills",
    "volato-sveltekit",
    "assets",
    "runtime",
  );
  if (existsSync(packaged)) return packaged;
  return join(
    __dirname,
    "..",
    "..",
    "skills",
    "volato-sveltekit",
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

function generatedPaths(options: GenerateSvelteKitOptions): Array<{
  path: string;
  source: string;
}> {
  const extension = options.project.language;
  const assets = options.sourceRoot ?? assetsRoot();
  const runtimeRoot = join(options.cwd, "volato-sveltekit");
  const browser =
    extension === "js"
      ? BROWSER_JAVASCRIPT_RUNTIME["browser.js"]
      : readFileSync(join(sharedBrowserRoot(), "browser.ts"), "utf8");
  const node =
    extension === "js"
      ? NODE_JAVASCRIPT_RUNTIME["node.js"]
      : readFileSync(join(sharedNodeRoot(), "node.ts"), "utf8");
  if (browser === undefined || node === undefined) {
    throw new Error("Generated SvelteKit transport assets are missing.");
  }
  return [
    { path: join(runtimeRoot, `browser.${extension}`), source: browser },
    {
      path: join(runtimeRoot, `client.${extension}`),
      source: readFileSync(join(assets, `client.${extension}`), "utf8"),
    },
    { path: join(runtimeRoot, `node.${extension}`), source: node },
    {
      path: join(runtimeRoot, `server.${extension}`),
      source: readFileSync(join(assets, `server.${extension}`), "utf8"),
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

function planHook(
  path: string,
  side: "client" | "server",
): PlannedHook {
  const factory =
    side === "client"
      ? "createVolatoSvelteKitClientHandleError"
      : "createVolatoSvelteKitServerHandleError";
  const importLine = `import { ${factory} } from "../volato-sveltekit/${side}";`;
  const exportLine = `export const handleError = ${factory}(__volatoApplicationHandleError);`;
  const emptyExportLine = `export const handleError = ${factory}();`;
  if (!existsSync(path)) {
    return {
      path,
      source: `${importLine}\n\n${emptyExportLine}\n`,
      status: "created",
      detail: `created the conventional SvelteKit ${side} error hook`,
    };
  }
  const original = readFileSync(path, "utf8");
  const alreadyGenerated = original.includes(importLine);
  if (alreadyGenerated) {
    const valid =
      (original.includes(exportLine) || original.includes(emptyExportLine)) &&
      (original.match(new RegExp(factory, "g")) ?? []).length === 2;
    if (!valid) {
      throw new Error(
        `SvelteKit ${side} handleError generated composition was edited and cannot be composed safely; no files were modified.`,
      );
    }
    return {
      path,
      source: original,
      status: "skipped",
      detail: `SvelteKit ${side} handleError already composes Volato`,
    };
  }
  if (original.includes("volato-sveltekit")) {
    throw new Error(
      `SvelteKit ${side} handleError contains a hand-written Volato import and cannot be composed safely; no files were modified.`,
    );
  }
  const named = [
    ...original.matchAll(/\bexport\s+(?:async\s+)?function\s+handleError\b/g),
  ];
  const expression = [
    ...original.matchAll(
      /\bexport\s+const\s+handleError(?=\s*(?::[^=\n]+)?=)/g,
    ),
  ];
  const ambiguousExport =
    /\bexport\s*\{[^}]*\bhandleError\b[^}]*\}/s.test(original) ||
    /\bexport\s*\*/.test(original);
  if (named.length + expression.length !== 1 || ambiguousExport) {
    throw new Error(
      `SvelteKit ${side} handleError ownership cannot be composed from one direct named or expression export; no files were modified.`,
    );
  }
  let composed = original;
  if (named.length === 1) {
    composed = composed.replace(
      /\bexport\s+((?:async\s+)?)function\s+handleError\b/,
      "$1function __volatoApplicationHandleError",
    );
  } else {
    composed = composed.replace(
      /\bexport\s+const\s+handleError(?=\s*(?::[^=\n]+)?=)/,
      "const __volatoApplicationHandleError",
    );
  }
  return {
    path,
    source: `${importLine}\n${composed}${composed.endsWith("\n") ? "" : "\n"}\n${exportLine}\n`,
    status: "updated",
    detail: `composed the existing SvelteKit ${side} handleError`,
  };
}

function assertConfigAndBuild(options: GenerateSvelteKitOptions): void {
  const config = readFileSync(options.project.configPath, "utf8");
  if (
    !/export\s+default\s+defineConfig\(\s*(?:withVolatoSvelteKit\(\s*)?\{[\s\S]*\}\s*(?:\)\s*)?\)\s*;?\s*$/.test(
      config,
    )
  ) {
    throw new Error(
      "SvelteKit Vite config cannot be composed as one static defineConfig object; no files were modified.",
    );
  }
  if (config.includes("withVolatoSvelteKit")) {
    const ownedImport =
      /^import\s*\{\s*withVolatoSvelteKit\s*}\s*from\s*["']\.\/volato-sveltekit\/build\.mjs["']\s*;?\s*$/m;
    if (!ownedImport.test(config)) {
      throw new Error(
        "The SvelteKit build wrapper is not owned by the generated helper; no files were modified.",
      );
    }
  }
  const pkg = JSON.parse(
    readFileSync(join(options.cwd, "package.json"), "utf8"),
  ) as { scripts?: { build?: unknown } };
  if (pkg.scripts?.build !== "vite build" && pkg.scripts?.build !== GENERATED_BUILD) {
    throw new Error(
      "SvelteKit package build script cannot be composed exactly; no files were modified.",
    );
  }
}

function patchConfig(project: SvelteKitProjectShape): PatchOutcome {
  const path = project.configPath;
  const original = readFileSync(path, "utf8");
  if (original.includes("withVolatoSvelteKit")) {
    return {
      path,
      status: "skipped",
      detail: "SvelteKit build already composes the Volato release and maps",
    };
  }
  const pattern = /export\s+default\s+defineConfig\(\s*(\{[\s\S]*\})\s*\)\s*;?\s*$/;
  const importLine =
    'import { withVolatoSvelteKit } from "./volato-sveltekit/build.mjs";\n';
  writeFileSync(
    path,
    `${importLine}${original.replace(
      pattern,
      "export default defineConfig(withVolatoSvelteKit($1));\n",
    )}`,
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
      detail: "SvelteKit sourcemap upload already follows the production build",
    };
  }
  pkg.scripts.build = GENERATED_BUILD;
  writeFileSync(path, `${JSON.stringify(pkg, null, 2)}\n`, "utf8");
  return {
    path,
    status: "updated",
    detail: "uploads and removes private client/server maps after the build",
  };
}

export function generateSvelteKitIntegration(options: GenerateSvelteKitOptions): {
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
  const previous = manifest.integrations[ERRORS_SVELTEKIT_INTEGRATION];
  if (previous) {
    const modified = modifiedGeneratedFiles(options.cwd, previous);
    if (modified.length > 0) {
      throw new Error(
        `Generated Volato SvelteKit files were edited or deleted: ${modified.join(", ")}. Review those changes before updating the integration.`,
      );
    }
  }
  const files = generatedPaths(options);
  const clientHook = planHook(options.project.clientHooksPath, "client");
  const serverHook = planHook(options.project.serverHooksPath, "server");
  assertConfigAndBuild(options);
  if (!previous) {
    const conflicts = files
      .filter(({ path }) => existsSync(path))
      .map(({ path }) => path);
    if (conflicts.length > 0) {
      throw new Error(
        `SvelteKit generated destinations already exist without a Volato manifest: ${conflicts.join(", ")}; no files were modified.`,
      );
    }
  }

  for (const file of files) {
    mkdirSync(dirname(file.path), { recursive: true });
    writeFileSync(file.path, file.source, "utf8");
  }
  for (const hook of [clientHook, serverHook]) {
    if (hook.status !== "skipped") {
      mkdirSync(dirname(hook.path), { recursive: true });
      writeFileSync(hook.path, hook.source, "utf8");
    }
  }
  const outcomes: PatchOutcome[] = [
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
    clientHook,
    serverHook,
  ];
  const generatedFiles = files.map(({ path }) => path);
  const integration = createGeneratedIntegration(options.cwd, {
    recipe: "errors-sveltekit",
    recipeVersion: SVELTEKIT_RECIPE_VERSION,
    files: generatedFiles,
  });
  const manifestPath = writeIntegration(
    options.cwd,
    ERRORS_SVELTEKIT_INTEGRATION,
    integration,
  );
  return {
    outcomes,
    runtimeRoot: join(options.cwd, "volato-sveltekit"),
    generatedFiles,
    manifestPath,
  };
}
