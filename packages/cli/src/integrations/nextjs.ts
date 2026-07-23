import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative } from "node:path";
import type { ProjectShape } from "../commands/init/detect";
import {
  patchEnvLocal,
  patchInstrumentation,
  patchLayout,
  patchNextConfig,
  patchTunnelRoute,
  type PatchOutcome,
} from "../commands/init/patch";
import {
  createManifest,
  modifiedGeneratedFiles,
  readManifest,
  writeManifest,
} from "./manifest";

export const NEXTJS_RECIPE_VERSION = "1.0.0";

export type GenerateNextjsOptions = {
  cwd: string;
  dsn: string;
  project: ProjectShape;
  sourceRoot?: string;
};

export type GenerateNextjsResult = {
  outcomes: PatchOutcome[];
  runtimeRoot: string;
  generatedFiles: string[];
  manifestPath: string;
};

function bundledRuntimeRoot(): string {
  return join(
    __dirname,
    "..",
    "skills",
    "volato-nextjs",
    "assets",
    "runtime",
  );
}

function runtimeFiles(root: string, prefix = ""): string[] {
  return readdirSync(join(root, prefix))
    .flatMap((name) => {
      const path = join(prefix, name);
      if (path.split(/[\\/]/).includes("__tests__")) return [];
      return statSync(join(root, path)).isDirectory()
        ? runtimeFiles(root, path)
        : [path];
    })
    .filter((path) => /\.(?:ts|tsx)$/.test(path))
    .sort();
}

function modulePath(fromFile: string, targetWithoutExtension: string): string {
  let path = relative(dirname(fromFile), targetWithoutExtension).replaceAll(
    "\\",
    "/",
  );
  if (!path.startsWith(".")) path = `./${path}`;
  return path;
}

function copyRuntime(sourceRoot: string, targetRoot: string): string[] {
  return runtimeFiles(sourceRoot).map((path) => {
    const target = join(targetRoot, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, readFileSync(join(sourceRoot, path)));
    return target;
  });
}

export function generateNextjsIntegration(
  options: GenerateNextjsOptions,
): GenerateNextjsResult {
  if (options.project.language !== "ts") {
    throw new Error(
      "The generated Next.js recipe currently requires a TypeScript App Router project.",
    );
  }

  const previous = readManifest(options.cwd);
  if (previous) {
    const modified = modifiedGeneratedFiles(options.cwd, previous);
    if (modified.length > 0) {
      throw new Error(
        `Generated Volato files were edited or deleted: ${modified.join(", ")}. Review those changes before updating the integration.`,
      );
    }
  }

  const sourceRoot = options.sourceRoot ?? bundledRuntimeRoot();
  if (!existsSync(sourceRoot)) {
    throw new Error(`Next.js recipe assets are missing: ${sourceRoot}`);
  }
  const runtimeRoot =
    options.project.appDir === "src/app"
      ? join(options.cwd, "src", "volato")
      : join(options.cwd, "volato");
  const generatedFiles = copyRuntime(sourceRoot, runtimeRoot);

  const outcomes: PatchOutcome[] = [
    patchEnvLocal(options.cwd, options.dsn),
    patchInstrumentation(
      options.project.instrumentationPath,
      options.project.language,
      modulePath(
        options.project.instrumentationPath,
        join(runtimeRoot, "instrumentation"),
      ),
    ),
    patchLayout(
      options.project.layoutPath,
      modulePath(options.project.layoutPath, join(runtimeRoot, "client")),
    ),
    patchNextConfig(
      options.project.nextConfigPath,
      options.project.nextConfigPath
        ? modulePath(
            options.project.nextConfigPath,
            join(runtimeRoot, "withVolato"),
          )
        : "./volato/withVolato",
    ),
    patchTunnelRoute(
      options.project.tunnelRoutePath,
      options.project.language,
      modulePath(
        options.project.tunnelRoutePath,
        join(runtimeRoot, "server"),
      ),
    ),
  ];

  const manifest = createManifest(options.cwd, {
    recipe: "nextjs-app-router",
    recipeVersion: NEXTJS_RECIPE_VERSION,
    files: generatedFiles,
  });
  const path = writeManifest(options.cwd, manifest);

  return {
    outcomes,
    runtimeRoot,
    generatedFiles,
    manifestPath: path,
  };
}
