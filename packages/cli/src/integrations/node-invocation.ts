import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative } from "node:path";
import type { NodeInvocationProjectShape } from "../commands/init/detect-errors.js";
import {
  patchEnvValues,
  type PatchOutcome,
} from "../commands/init/patch.js";
import { NODE_JAVASCRIPT_RUNTIME } from "../generated/node-javascript-runtime.js";
import {
  createGeneratedIntegration,
  ERRORS_NODE_INVOCATION_INTEGRATION,
  modifiedGeneratedFiles,
  readManifest,
  writeIntegration,
} from "./manifest.js";
import { patchNodeBuildScript } from "./node.js";

export const NODE_INVOCATION_RECIPE_VERSION = "1.0.0";

export type GenerateNodeInvocationOptions = {
  cwd: string;
  dsn: string;
  ingestToken?: string;
  project: NodeInvocationProjectShape;
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

function runtimeExtension(project: NodeInvocationProjectShape): "ts" | "js" | "cjs" {
  if (project.language === "ts") return "ts";
  return project.module === "cjs" ? "cjs" : "js";
}

function copyRuntime(
  sourceRoot: string,
  targetRoot: string,
  project: NodeInvocationProjectShape,
): string[] {
  const extension = runtimeExtension(project);
  return [`node.${extension}`, `invocation.${extension}`, "upload-sourcemaps.mjs"].map(
    (name) => {
      const target = join(targetRoot, name);
      mkdirSync(dirname(target), { recursive: true });
      if (project.language === "js" && name !== "upload-sourcemaps.mjs") {
        const generated = NODE_JAVASCRIPT_RUNTIME[name];
        if (!generated) {
          throw new Error(`Generated Node invocation runtime is missing: ${name}`);
        }
        writeFileSync(target, generated, "utf8");
      } else {
        writeFileSync(target, readFileSync(join(sourceRoot, name)));
      }
      return target;
    },
  );
}

function patchHandler(
  project: NodeInvocationProjectShape,
  runtimeRoot: string,
): PatchOutcome {
  const path = project.handlerPath;
  const original = readFileSync(path, "utf8");
  if (original.includes("withVolatoInvocation")) {
    return {
      path,
      status: "skipped",
      detail: "invocation handler already wrapped",
    };
  }

  let composed = original;
  if (/export\s+const\s+handler(?:\s*:[^=\n]+)?\s*=\s*async\b/m.test(composed)) {
    composed = composed.replace(
      /export\s+const\s+handler(\s*:[^=\n]+)?\s*=\s*async\b/m,
      "const volatoOriginalHandler$1 = async",
    );
  } else if (/export\s+async\s+function\s+handler\b/m.test(composed)) {
    composed = composed.replace(
      /export\s+async\s+function\s+handler\b/m,
      "async function volatoOriginalHandler",
    );
  } else if (/(?:module\.)?exports\.handler\s*=\s*async\b/m.test(composed)) {
    composed = composed.replace(
      /(?:module\.)?exports\.handler\s*=\s*async\b/m,
      "const volatoOriginalHandler = async",
    );
  } else {
    return {
      path,
      status: "manual",
      detail:
        "the exported asynchronous handler syntax changed after detection; no handler composition was written",
    };
  }

  const sourceUsesEsm = project.language === "ts" || project.module === "esm";
  const runtimeFile = join(
    runtimeRoot,
    `invocation.${project.language === "js" && project.module === "cjs" ? "cjs" : "js"}`,
  );
  const specifier = modulePath(path, runtimeFile);
  const importLine = sourceUsesEsm
    ? `import { withVolatoInvocation } from ${JSON.stringify(specifier)};\n`
    : `const { withVolatoInvocation } = require(${JSON.stringify(specifier)});\n`;
  const options =
    project.handlerShape === "node-http-handler"
      ? '{ functionName: "handler", http: true }'
      : '{ functionName: "handler" }';
  const exportLine = sourceUsesEsm
    ? `export const handler = withVolatoInvocation(volatoOriginalHandler, ${options});\n`
    : `exports.handler = withVolatoInvocation(volatoOriginalHandler, ${options});\n`;
  const body = composed.endsWith("\n") ? composed : `${composed}\n`;
  writeFileSync(path, `${importLine}${body}${exportLine}`, "utf8");
  return {
    path,
    status: "updated",
    detail:
      project.handlerShape === "node-http-handler"
        ? "wrapped asynchronous Node HTTP invocation with bounded context"
        : "wrapped asynchronous invocation with bounded end-of-call capture",
  };
}

export function generateNodeInvocationIntegration(
  options: GenerateNodeInvocationOptions,
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
  const previous = manifest.integrations[ERRORS_NODE_INVOCATION_INTEGRATION];
  if (previous) {
    const modified = modifiedGeneratedFiles(options.cwd, previous);
    if (modified.length > 0) {
      throw new Error(
        `Generated Volato Node invocation files were edited or deleted: ${modified.join(", ")}. Review those changes before updating the integration.`,
      );
    }
  }
  const sourceRoot = options.sourceRoot ?? assetsRoot();
  if (!existsSync(sourceRoot)) {
    throw new Error(`Node invocation recipe assets are missing: ${sourceRoot}`);
  }
  const runtimeRoot = join(dirname(options.project.handlerPath), "volato-invocation");
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
    patchHandler(options.project, runtimeRoot),
    patchNodeBuildScript(options.cwd, runtimeRoot, options.project),
  ];
  const integration = createGeneratedIntegration(options.cwd, {
    recipe: "errors-node-invocation",
    recipeVersion: NODE_INVOCATION_RECIPE_VERSION,
    files: generatedFiles,
  });
  const manifestPath = writeIntegration(
    options.cwd,
    ERRORS_NODE_INVOCATION_INTEGRATION,
    integration,
  );
  return { outcomes, runtimeRoot, generatedFiles, manifestPath };
}
