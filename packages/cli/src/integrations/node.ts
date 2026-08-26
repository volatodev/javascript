import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import type { NodeProjectShape } from "../commands/init/detect-errors.js";
import {
  patchEnvValues,
  type PatchOutcome,
} from "../commands/init/patch.js";
import {
  createGeneratedIntegration,
  ERRORS_NODE_INTEGRATION,
  modifiedGeneratedFiles,
  readManifest,
  writeIntegration,
} from "./manifest.js";
import { NODE_JAVASCRIPT_RUNTIME } from "../generated/node-javascript-runtime.js";

export const NODE_RECIPE_VERSION = "1.2.0";

export type GenerateNodeOptions = {
  cwd: string;
  dsn: string;
  ingestToken?: string;
  project: NodeProjectShape;
  sourceRoot?: string;
};

function assetsRoot(): string {
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

function modulePath(fromFile: string, target: string): string {
  let path = relative(dirname(fromFile), target).replaceAll("\\", "/");
  if (!path.startsWith(".")) path = `./${path}`;
  return path;
}

function copyRuntime(
  sourceRoot: string,
  targetRoot: string,
  project: NodeProjectShape,
): string[] {
  const extension =
    project.language === "ts"
      ? "ts"
      : project.module === "cjs"
        ? "cjs"
        : "js";
  const names = [`node.${extension}`, `express.${extension}`, "upload-sourcemaps.mjs"];
  return names.map((name) => {
    const target = join(targetRoot, name);
    mkdirSync(dirname(target), { recursive: true });
    if (project.language === "js" && name !== "upload-sourcemaps.mjs") {
      const generated = NODE_JAVASCRIPT_RUNTIME[name];
      if (!generated) throw new Error(`Generated Node runtime is missing: ${name}`);
      writeFileSync(target, generated, "utf8");
    } else {
      writeFileSync(target, readFileSync(join(sourceRoot, name)));
    }
    return target;
  });
}

function runtimeModulePath(
  project: NodeProjectShape,
  runtimeRoot: string,
  name: "node" | "express",
  fromPath = project.entryPath,
): string {
  const extension =
    project.language === "js" && project.module === "cjs" ? "cjs" : "js";
  return modulePath(fromPath, join(runtimeRoot, `${name}.${extension}`));
}

function importRuntime(
  project: NodeProjectShape,
  name: "initVolatoNode" | "volatoExpressErrorHandler",
  path: string,
): string {
  return project.module === "cjs"
    ? `const { ${name} } = require(${JSON.stringify(path)});\n`
    : `import { ${name} } from ${JSON.stringify(path)};\n`;
}

function prependInitialization(original: string, prefix: string): string {
  const shebang = /^(#![^\n]*(?:\n|$))/.exec(original)?.[1];
  return shebang
    ? `${shebang}${prefix}${original.slice(shebang.length)}`
    : `${prefix}${original}`;
}

function patchNodeEntry(
  project: NodeProjectShape,
  runtimeRoot: string,
): PatchOutcome[] {
  const path = project.entryPath;
  const original = readFileSync(path, "utf8");
  const existingFatalHandlers = [
    "uncaughtException",
    "unhandledRejection",
  ].filter((event) =>
    new RegExp(
      `process\\.(?:on|once|prependListener)\\s*\\(\\s*["']${event}["']`,
    ).test(original),
  );
  if (
    existingFatalHandlers.length > 0 &&
    !original.includes("installFatalHandlers: false")
  ) {
    return [
      {
        path,
        status: "manual",
        detail:
          `existing ${existingFatalHandlers.join(" and ")} handlers detected; ` +
          "import and await captureNodeException inside each handler with its capturedVia value, initialize initVolatoNode({ installFatalHandlers: false }), and keep the original handlers' cleanup and exit semantics",
      },
    ];
  }
  if (original.includes("initVolatoNode")) {
    return [{ path, status: "skipped", detail: "Node capture already initialized" }];
  }
  const nodeImport = importRuntime(
    project,
    "initVolatoNode",
    runtimeModulePath(project, runtimeRoot, "node"),
  );
  writeFileSync(
    path,
    prependInitialization(original, `${nodeImport}initVolatoNode();\n`),
    "utf8",
  );
  return [
    {
      path,
      status: "updated",
      detail: project.express
        ? "initialized long-lived Node process capture"
        : "initialized generic Node capture without Express HTTP context",
    },
  ];
}

function lineStart(source: string, index: number): number {
  return source.lastIndexOf("\n", Math.max(0, index - 1)) + 1;
}

function inlineErrorHandlerIndex(source: string): number | null {
  const match = /^[ \t]*app\.use\s*\(\s*(?:async\s*)?\(?\s*(?:err|error)\b[^\n]*=>/m.exec(
    source,
  );
  return match?.index ?? null;
}

function namedErrorHandlerIndex(source: string): number | null {
  const mounts = [...source.matchAll(/^[ \t]*app\.use\s*\(\s*([A-Za-z_$][\w$]*)\s*\)\s*;?/gm)];
  for (const mount of mounts) {
    const name = mount[1]!;
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const declaration = new RegExp(
      `(?:function\\s+${escaped}\\s*\\(|(?:const|let|var)\\s+${escaped}\\s*=\\s*(?:async\\s*)?\\(?)([^)]*)`,
    ).exec(source);
    if (
      declaration &&
      (declaration[1]?.match(/,/g)?.length ?? 0) >= 3
    ) {
      return mount.index;
    }
  }
  return null;
}

function expressMountBoundary(
  source: string,
  topology: "same-file" | "split-bootstrap",
): number | null {
  const existingErrorHandler =
    inlineErrorHandlerIndex(source) ?? namedErrorHandlerIndex(source);
  if (existingErrorHandler !== null) return lineStart(source, existingErrorHandler);
  const boundaryPatterns =
    topology === "same-file"
      ? [/\bapp\.listen\s*\(/]
      : [/\bmodule\.exports\s*=\s*app\b/, /\bexport\s+default\s+app\b/, /\bexport\s*\{[^}]*\bapp\b[^}]*\}/];
  for (const pattern of boundaryPatterns) {
    const index = source.search(pattern);
    if (index >= 0) return lineStart(source, index);
  }
  return null;
}

function patchExpressApp(
  project: NodeProjectShape,
  runtimeRoot: string,
): PatchOutcome[] {
  if (
    !project.express ||
    !project.expressAppPath ||
    !project.expressTopology
  ) {
    return [];
  }
  const path = project.expressAppPath;
  const original = readFileSync(path, "utf8");
  if (original.includes("volatoExpressErrorHandler")) {
    return [
      {
        path,
        status: "skipped",
        detail: "Express error capture already mounted",
      },
    ];
  }
  const boundary = expressMountBoundary(original, project.expressTopology);
  if (boundary === null) {
    return [
      {
        path,
        status: "manual",
        detail:
          "mount volatoExpressErrorHandler after all routes and before the existing Express error handler or app export",
      },
    ];
  }
  const withMount = `${original.slice(0, boundary)}app.use(volatoExpressErrorHandler());\n${original.slice(boundary)}`;
  const expressImport = importRuntime(
    project,
    "volatoExpressErrorHandler",
    runtimeModulePath(project, runtimeRoot, "express", path),
  );
  writeFileSync(path, prependInitialization(withMount, expressImport), "utf8");
  return [
    {
      path,
      status: "updated",
      detail:
        "mounted Express capture after routes and before application-owned error handling",
    },
  ];
}

function patchBuildScript(
  cwd: string,
  runtimeRoot: string,
  project: NodeProjectShape,
): PatchOutcome {
  const path = join(cwd, "package.json");
  const pkg = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  const scripts =
    pkg.scripts && typeof pkg.scripts === "object"
      ? (pkg.scripts as Record<string, unknown>)
      : null;
  const build = scripts?.build;
  if (typeof build !== "string") {
    if (project.language === "js") {
      return {
        path,
        status: "skipped",
        detail: "direct JavaScript source needs no production sourcemap upload",
      };
    }
    return {
      path,
      status: "manual",
      detail: "add a production build with sourcemaps before enabling Node map upload",
    };
  }
  const uploader = relative(cwd, join(runtimeRoot, "upload-sourcemaps.mjs")).replaceAll(
    "\\",
    "/",
  );
  if (build.includes("upload-sourcemaps.mjs")) {
    return { path, status: "skipped", detail: "Node sourcemap upload already follows build" };
  }
  if (!/source-?map/i.test(build)) {
    return {
      path,
      status: "manual",
      detail:
        "the Node build does not visibly enable sourcemaps; enable them, then append the generated uploader",
    };
  }
  const postbuild = scripts?.postbuild;
  if (
    typeof postbuild === "string" &&
    commandRunsUploader(postbuild, uploader)
  ) {
    return {
      path,
      status: "skipped",
      detail: "Node sourcemap upload already follows build",
    };
  }
  const outputDirectory = detectBuildOutputDirectory(cwd, build);
  if (!outputDirectory) {
    return {
      path,
      status: "manual",
      detail:
        "the Node build output directory is ambiguous; run the generated sourcemap uploader with the repository-relative output directory after the production build",
    };
  }
  scripts!.build = `${build} && node ${uploader} ${outputDirectory}`;
  writeFileSync(path, `${JSON.stringify(pkg, null, 2)}\n`, "utf8");
  return {
    path,
    status: "updated",
    detail: `uploads privacy-cleaned Node sourcemaps from ${outputDirectory} after build`,
  };
}

function commandRunsUploader(command: string, uploader: string): boolean {
  const normalizedUploader = uploader.replace(/^\.\//, "");
  const escapedUploader = normalizedUploader.replace(
    /[.*+?^${}()|[\]\\]/g,
    "\\$&",
  );
  const output = new RegExp(
    `(?:^|(?:&&|;)\\s*)node\\s+(?:\\.\\/)?${escapedUploader}\\s+((?:["'][^"']+["'])|[a-zA-Z0-9._/-]+)(?=\\s*(?:$|&&|;))`,
  ).exec(command)?.[1];
  return safeOutputDirectory(output) !== null;
}

function safeOutputDirectory(value: string | undefined): string | null {
  const normalized = value?.trim().replace(/^['"]|['"]$/g, "");
  if (
    !normalized ||
    normalized.startsWith("/") ||
    normalized === ".." ||
    normalized.startsWith("../") ||
    normalized.includes("/../") ||
    !/^[a-zA-Z0-9._/-]+$/.test(normalized)
  ) {
    return null;
  }
  return normalized.replace(/^\.\//, "").replace(/\/$/, "");
}

function detectBuildOutputDirectory(cwd: string, build: string): string | null {
  const explicit =
    /(?:--out-dir|--outDir|--outdir)(?:=|\s+)(['"]?[a-zA-Z0-9._/-]+['"]?)/.exec(
      build,
    )?.[1];
  if (explicit) return safeOutputDirectory(explicit);

  if (/(?:^|\s)tsup(?:\s|$)/.test(build)) return "dist";

  if (/(?:^|\s)tsc(?:\s|$)/.test(build)) {
    const configMatch = /(?:--project|-p)(?:=|\s+)(['"]?[a-zA-Z0-9._/-]+['"]?)/.exec(
      build,
    )?.[1];
    const configRelative = configMatch
      ? safeOutputDirectory(configMatch)
      : "tsconfig.json";
    if (!configRelative) return null;
    const configPath = join(cwd, configRelative);
    if (!existsSync(configPath)) return null;
    const config = readFileSync(configPath, "utf8");
    const configuredOutDir =
      /["']outDir["']\s*:\s*["']([^"']+)["']/.exec(config)?.[1];
    if (!configuredOutDir) return null;
    return safeOutputDirectory(
      relative(cwd, resolve(dirname(configPath), configuredOutDir)).replaceAll(
        "\\",
        "/",
      ),
    );
  }

  return null;
}

export function generateNodeIntegration(
  options: GenerateNodeOptions,
): { outcomes: PatchOutcome[]; runtimeRoot: string; generatedFiles: string[]; manifestPath: string } {
  const manifest = readManifest(options.cwd);
  if (!manifest) {
    throw new Error(
      "This repository is not connected to Volato. Run `volato init --project <id>` first.",
    );
  }
  const previous = manifest.integrations[ERRORS_NODE_INTEGRATION];
  if (previous) {
    const modified = modifiedGeneratedFiles(options.cwd, previous);
    if (modified.length > 0) {
      throw new Error(
        `Generated Volato Node files were edited or deleted: ${modified.join(", ")}. Review those changes before updating the integration.`,
      );
    }
  }
  const sourceRoot = options.sourceRoot ?? assetsRoot();
  if (!existsSync(sourceRoot)) throw new Error(`Node recipe assets are missing: ${sourceRoot}`);
  const sourceDirectory = dirname(options.project.entryPath);
  const runtimeRoot = join(sourceDirectory, "volato-node");
  const generatedFiles = copyRuntime(sourceRoot, runtimeRoot, options.project);
  const outcomes: PatchOutcome[] = [
    patchEnvValues(
      options.cwd,
      [
        { key: "VOLATO_DSN", value: options.dsn },
        ...(options.ingestToken
          ? [{ key: "VOLATO_INGEST_TOKEN", value: options.ingestToken }]
          : []),
      ],
      options.ingestToken !== undefined,
    ),
    ...patchNodeEntry(options.project, runtimeRoot),
    ...patchExpressApp(options.project, runtimeRoot),
    patchBuildScript(options.cwd, runtimeRoot, options.project),
  ];
  const integration = createGeneratedIntegration(options.cwd, {
    recipe: options.project.express ? "errors-node-express" : "errors-node",
    recipeVersion: NODE_RECIPE_VERSION,
    files: generatedFiles,
  });
  const manifestPath = writeIntegration(
    options.cwd,
    ERRORS_NODE_INTEGRATION,
    integration,
  );
  return { outcomes, runtimeRoot, generatedFiles, manifestPath };
}
