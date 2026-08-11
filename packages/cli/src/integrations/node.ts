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

export const NODE_RECIPE_VERSION = "1.0.0";

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
  return `${path}.js`;
}

function copyRuntime(
  sourceRoot: string,
  targetRoot: string,
  language: "ts" | "js",
): string[] {
  const extension = language === "ts" ? "ts" : "js";
  const names = [`node.${extension}`, `express.${extension}`, "upload-sourcemaps.mjs"];
  return names.map((name) => {
    const source = join(sourceRoot, name);
    const target = join(targetRoot, name);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, readFileSync(source));
    return target;
  });
}

function patchNodeEntry(
  project: NodeProjectShape,
  runtimeRoot: string,
): PatchOutcome[] {
  const path = project.entryPath;
  const original = readFileSync(path, "utf8");
  if (original.includes("initVolatoNode")) {
    return [{ path, status: "skipped", detail: "Node capture already initialized" }];
  }
  const nodeImport = `import { initVolatoNode } from ${JSON.stringify(
    modulePath(path, join(runtimeRoot, "node")),
  )};\n`;
  let prefix = `${nodeImport}initVolatoNode();\n`;
  let body = original;
  const outcomes: PatchOutcome[] = [];

  if (project.express) {
    if (/app\.use\([\s\S]{0,120}\b(?:err|error)\b/.test(original)) {
      return [
        {
          path,
          status: "manual",
          detail:
            "existing Express error middleware detected; place volatoExpressErrorHandler before it so the existing response behavior remains authoritative",
        },
      ];
    }
    const listenIndex = body.lastIndexOf("app.listen");
    if (listenIndex < 0) {
      return [
        {
          path,
          status: "manual",
          detail:
            "Express app.listen call was not found; mount volatoExpressErrorHandler after routes and before the existing error handler",
        },
      ];
    }
    const expressImport = `import { volatoExpressErrorHandler } from ${JSON.stringify(
      modulePath(path, join(runtimeRoot, "express")),
    )};\n`;
    prefix = `${nodeImport}${expressImport}initVolatoNode();\n`;
    const listenLineStart = body.lastIndexOf("\n", listenIndex) + 1;
    body = `${body.slice(0, listenLineStart)}app.use(volatoExpressErrorHandler());\n${body.slice(listenLineStart)}`;
    outcomes.push({
      path,
      status: "updated",
      detail: "initialized Node capture and mounted Express error middleware after routes",
    });
  } else {
    outcomes.push({
      path,
      status: "updated",
      detail: "initialized generic Node capture without Express HTTP context",
    });
  }
  writeFileSync(path, `${prefix}${body}`, "utf8");
  return outcomes;
}

function patchBuildScript(cwd: string, runtimeRoot: string): PatchOutcome {
  const path = join(cwd, "package.json");
  const pkg = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  const scripts =
    pkg.scripts && typeof pkg.scripts === "object"
      ? (pkg.scripts as Record<string, unknown>)
      : null;
  const build = scripts?.build;
  if (typeof build !== "string") {
    return {
      path,
      status: "manual",
      detail: "add a production build with sourcemaps before enabling Node map upload",
    };
  }
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
  const outputDirectory = detectBuildOutputDirectory(cwd, build);
  if (!outputDirectory) {
    return {
      path,
      status: "manual",
      detail:
        "the Node build output directory is ambiguous; run the generated sourcemap uploader with the repository-relative output directory after the production build",
    };
  }
  const uploader = relative(cwd, join(runtimeRoot, "upload-sourcemaps.mjs")).replaceAll(
    "\\",
    "/",
  );
  scripts!.build = `${build} && node ${uploader} ${outputDirectory}`;
  writeFileSync(path, `${JSON.stringify(pkg, null, 2)}\n`, "utf8");
  return {
    path,
    status: "updated",
    detail: `uploads privacy-cleaned Node sourcemaps from ${outputDirectory} after build`,
  };
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
  const generatedFiles = copyRuntime(sourceRoot, runtimeRoot, options.project.language);
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
    patchBuildScript(options.cwd, runtimeRoot),
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
