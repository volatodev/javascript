import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { FastifyProjectShape } from "../commands/init/detect-errors.js";
import { patchEnvValues, type PatchOutcome } from "../commands/init/patch.js";
import {
  importNodeRuntime,
  nodeAssetsRoot,
  nodeRuntimeModulePath,
  patchNodeBuildScript,
  patchNodeEntry,
  prependNodeInitialization,
  writeNodeRuntimeFiles,
} from "./node.js";
import {
  createGeneratedIntegration,
  ERRORS_NODE_FASTIFY_INTEGRATION,
  modifiedGeneratedFiles,
  readManifest,
  writeIntegration,
} from "./manifest.js";

export const FASTIFY_RECIPE_VERSION = "1.0.0";

export type GenerateFastifyOptions = {
  cwd: string;
  dsn: string;
  ingestToken?: string;
  project: FastifyProjectShape;
  sourceRoot?: string;
};

function creationPattern(project: FastifyProjectShape): RegExp {
  const variable = project.appVariable.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(
    `(^|\\n)([ \\t]*(?:const|let|var)\\s+${variable}\\s*=\\s*(?:(?:Fastify|fastify)(?:\\.default)?|require\\s*\\(\\s*["']fastify["']\\s*\\))\\s*\\([^\\n]*\\);?[ \\t]*(?:\\n|$))`,
  );
}

function assertComposableFastifyApp(project: FastifyProjectShape): void {
  const source = readFileSync(project.appPath, "utf8");
  if (source.includes("volatoFastifyErrorHook")) return;
  if (!creationPattern(project).test(source)) {
    throw new Error(
      "The Fastify instance creation is not one static statement; no files were modified.",
    );
  }
}

function patchFastifyApp(
  project: FastifyProjectShape,
  runtimeRoot: string,
): PatchOutcome {
  const path = project.appPath;
  const original = readFileSync(path, "utf8");
  if (original.includes("volatoFastifyErrorHook")) {
    return {
      path,
      status: "skipped",
      detail: "Fastify onError capture already registered",
    };
  }
  const pattern = creationPattern(project);
  const match = pattern.exec(original);
  if (!match) {
    return {
      path,
      status: "manual",
      detail: "register volatoFastifyErrorHook on the root Fastify instance",
    };
  }
  const hookImport = importNodeRuntime(
    project,
    "volatoFastifyErrorHook",
    nodeRuntimeModulePath(project, runtimeRoot, "fastify", path),
  );
  const withHook = original.replace(
    pattern,
    `$1$2${project.appVariable}.addHook("onError", volatoFastifyErrorHook());\n`,
  );
  writeFileSync(
    path,
    prependNodeInitialization(withHook, hookImport),
    "utf8",
  );
  return {
    path,
    status: "updated",
    detail: "registered root Fastify onError capture before application handling",
  };
}

export function generateFastifyIntegration(
  options: GenerateFastifyOptions,
): {
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
  const previous = manifest.integrations[ERRORS_NODE_FASTIFY_INTEGRATION];
  if (previous) {
    const modified = modifiedGeneratedFiles(options.cwd, previous);
    if (modified.length > 0) {
      throw new Error(
        `Generated Volato Fastify files were edited or deleted: ${modified.join(", ")}. Review those changes before updating the integration.`,
      );
    }
  }
  assertComposableFastifyApp(options.project);
  const sourceRoot = options.sourceRoot ?? nodeAssetsRoot();
  if (!existsSync(sourceRoot)) {
    throw new Error(`Fastify recipe assets are missing: ${sourceRoot}`);
  }
  const runtimeRoot = join(dirname(options.project.entryPath), "volato-node");
  const generatedFiles = writeNodeRuntimeFiles(
    sourceRoot,
    runtimeRoot,
    options.project,
    ["node", "fastify"],
  );
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
    patchFastifyApp(options.project, runtimeRoot),
    patchNodeBuildScript(options.cwd, runtimeRoot, options.project),
  ];
  const integration = createGeneratedIntegration(options.cwd, {
    recipe: "errors-node-fastify",
    recipeVersion: FASTIFY_RECIPE_VERSION,
    files: generatedFiles,
  });
  const manifestPath = writeIntegration(
    options.cwd,
    ERRORS_NODE_FASTIFY_INTEGRATION,
    integration,
  );
  return { outcomes, runtimeRoot, generatedFiles, manifestPath };
}
