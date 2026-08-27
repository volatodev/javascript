import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { NestProjectShape } from "../commands/init/detect-errors.js";
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
  ERRORS_NODE_NESTJS_INTEGRATION,
  modifiedGeneratedFiles,
  readManifest,
  writeIntegration,
} from "./manifest.js";

export const NEST_RECIPE_VERSION = "1.0.0";

export type GenerateNestOptions = {
  cwd: string;
  dsn: string;
  ingestToken?: string;
  project: NestProjectShape;
  sourceRoot?: string;
};

function creationPattern(project: NestProjectShape): RegExp {
  const variable = project.appVariable.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(
    `(^|\\n)([ \\t]*const\\s+${variable}\\s*=\\s*await\\s+NestFactory\\.create(?:<[^\\n;]+>)?\\([^\\n]*\\);[ \\t]*\\n)`,
  );
}

function assertComposableNestBootstrap(project: NestProjectShape): void {
  const source = readFileSync(project.entryPath, "utf8");
  if (source.includes("VolatoHttpExceptionFilter")) return;
  if (!creationPattern(project).test(source)) {
    throw new Error(
      "NestFactory.create must remain one static bootstrap statement for deterministic filter composition; no files were modified.",
    );
  }
}

function patchNestBootstrap(
  project: NestProjectShape,
  runtimeRoot: string,
): PatchOutcome {
  const path = project.entryPath;
  const original = readFileSync(path, "utf8");
  if (original.includes("VolatoHttpExceptionFilter")) {
    return {
      path,
      status: "skipped",
      detail: "NestJS catch-all capture already registered",
    };
  }
  const pattern = creationPattern(project);
  const match = pattern.exec(original);
  if (!match) {
    return {
      path,
      status: "manual",
      detail: "register the generated Volato filter immediately after NestFactory.create",
    };
  }
  const indent = /^[ \t]*/.exec(match[2]!)?.[0] ?? "";
  const filterImport = importNodeRuntime(
    project,
    "VolatoHttpExceptionFilter",
    nodeRuntimeModulePath(project, runtimeRoot, "nestjs", path),
  );
  const imports =
    'import { HttpAdapterHost } from "@nestjs/core";\n' + filterImport;
  const withFilter = original.replace(
    pattern,
    `$1$2${indent}const { httpAdapter } = ${project.appVariable}.get(HttpAdapterHost);\n${indent}${project.appVariable}.useGlobalFilters(new VolatoHttpExceptionFilter(httpAdapter));\n`,
  );
  writeFileSync(
    path,
    prependNodeInitialization(withFilter, imports),
    "utf8",
  );
  return {
    path,
    status: "updated",
    detail: `registered one delegated NestJS catch-all filter on ${project.transport}`,
  };
}

export function generateNestIntegration(
  options: GenerateNestOptions,
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
  const previous = manifest.integrations[ERRORS_NODE_NESTJS_INTEGRATION];
  if (previous) {
    const modified = modifiedGeneratedFiles(options.cwd, previous);
    if (modified.length > 0) {
      throw new Error(
        `Generated Volato NestJS files were edited or deleted: ${modified.join(", ")}. Review those changes before updating the integration.`,
      );
    }
  }
  assertComposableNestBootstrap(options.project);
  const sourceRoot = options.sourceRoot ?? nodeAssetsRoot();
  if (!existsSync(sourceRoot)) {
    throw new Error(`NestJS recipe assets are missing: ${sourceRoot}`);
  }
  const runtimeRoot = join(dirname(options.project.entryPath), "volato-node");
  const generatedFiles = writeNodeRuntimeFiles(
    sourceRoot,
    runtimeRoot,
    options.project,
    ["node", "nestjs"],
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
    patchNestBootstrap(options.project, runtimeRoot),
    patchNodeBuildScript(options.cwd, runtimeRoot, options.project),
  ];
  const integration = createGeneratedIntegration(options.cwd, {
    recipe: `errors-node-nestjs-${options.project.transport}`,
    recipeVersion: NEST_RECIPE_VERSION,
    files: generatedFiles,
  });
  const manifestPath = writeIntegration(
    options.cwd,
    ERRORS_NODE_NESTJS_INTEGRATION,
    integration,
  );
  return { outcomes, runtimeRoot, generatedFiles, manifestPath };
}
