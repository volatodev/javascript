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
  NEXTJS_JAVASCRIPT_RUNTIME,
  NEXTJS_WITH_VOLATO_COMMONJS_RUNTIME,
} from "../generated/nextjs-javascript-runtime";
import {
  patchEnvLocal,
  patchErrorBoundary,
  patchInstrumentation,
  patchLayout,
  patchNextBuildScript,
  patchNextConfig,
  patchPagesApp,
  patchPagesError,
  patchProxy,
  type PatchOutcome,
} from "../commands/init/patch";
import {
  createGeneratedIntegration,
  ERRORS_NEXTJS_INTEGRATION,
  modifiedGeneratedFiles,
  readManifest,
  writeIntegration,
} from "./manifest";

export const NEXTJS_RECIPE_VERSION = "3.0.0";

export type GenerateNextjsOptions = {
  cwd: string;
  dsn: string;
  ingestToken?: string;
  project: ProjectShape;
  sourceRoot?: string;
  javascriptRuntime?: Readonly<Record<string, string>>;
};

export type GenerateNextjsResult = {
  outcomes: PatchOutcome[];
  runtimeRoot: string;
  generatedFiles: string[];
  manifestPath: string;
};

function bundledRuntimeRoot(): string {
  return join(__dirname, "..", "skills", "volato-nextjs", "assets", "runtime");
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
    .filter((path) => /\.(?:ts|tsx|cjs)$/.test(path))
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

function copyJavascriptRuntime(
  runtime: Readonly<Record<string, string>>,
  targetRoot: string,
): string[] {
  return Object.entries(runtime)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([path, source]) => {
      const target = join(targetRoot, path);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, source, "utf8");
      return target;
    });
}

function runtimeBoundaryOutcome(
  path: string | null,
  wrapper: "wrapMiddleware" | "wrapProxy",
): PatchOutcome | null {
  if (!path) return null;
  const source = readFileSync(path, "utf8");
  const composed =
    source.includes("volato/") &&
    new RegExp(`\\b${wrapper}\\s*\\(`).test(source);
  return composed
    ? {
        path,
        status: "skipped",
        detail: `${wrapper} is already composed`,
      }
    : {
        path,
        status: "manual",
        detail: `existing runtime boundary must be composed with ${wrapper}`,
      };
}

export function generateNextjsIntegration(
  options: GenerateNextjsOptions,
): GenerateNextjsResult {
  const manifest = readManifest(options.cwd);
  if (!manifest) {
    throw new Error(
      "This repository is not connected to Volato. Run `volato init --project <id>` first.",
    );
  }
  const previous = manifest.integrations[ERRORS_NEXTJS_INTEGRATION];
  if (previous) {
    const modified = modifiedGeneratedFiles(options.cwd, previous);
    if (modified.length > 0) {
      throw new Error(
        `Generated Volato files were edited or deleted: ${modified.join(
          ", ",
        )}. Review those changes before updating the integration.`,
      );
    }
  }

  const sourceRoot = options.sourceRoot ?? bundledRuntimeRoot();
  if (options.project.language === "ts" && !existsSync(sourceRoot)) {
    throw new Error(`Next.js recipe assets are missing: ${sourceRoot}`);
  }
  const runtimeRoot =
    options.project.appDir === "src/app" ||
    options.project.pagesDir === "src/pages"
      ? join(options.cwd, "src", "volato")
      : join(options.cwd, "volato");
  const generatedFiles =
    options.project.language === "ts"
      ? copyRuntime(sourceRoot, runtimeRoot)
      : copyJavascriptRuntime(
          options.javascriptRuntime ?? NEXTJS_JAVASCRIPT_RUNTIME,
          runtimeRoot,
        );
  const commonJsBuildHelper = join(runtimeRoot, "withVolato.cjs");
  writeFileSync(
    commonJsBuildHelper,
    NEXTJS_WITH_VOLATO_COMMONJS_RUNTIME,
    "utf8",
  );
  generatedFiles.push(commonJsBuildHelper);
  const runtimeExtension = options.project.language === "js" ? ".js" : "";
  const clientExtension = options.project.language === "js" ? ".jsx" : "";

  const outcomes: PatchOutcome[] = [
    patchEnvLocal(options.cwd, options.dsn, options.ingestToken),
    patchInstrumentation(
      options.project.instrumentationPath,
      options.project.language,
      modulePath(
        options.project.instrumentationPath,
        join(runtimeRoot, `instrumentation${runtimeExtension}`),
      ),
    ),
  ];
  if (options.project.layoutPath && options.project.errorBoundaryPath) {
    outcomes.push(
      patchLayout(
        options.project.layoutPath,
        modulePath(
          options.project.layoutPath,
          join(runtimeRoot, `client${clientExtension}`),
        ),
        options.project.language,
      ),
      patchErrorBoundary(
        options.project.errorBoundaryPath,
        modulePath(
          options.project.errorBoundaryPath,
          join(runtimeRoot, `error-boundary${clientExtension}`),
        ),
        options.project.language,
      ),
    );
  }
  if (options.project.pagesAppPath && options.project.pagesErrorPath) {
    outcomes.push(
      patchPagesApp(
        options.project.pagesAppPath,
        modulePath(
          options.project.pagesAppPath,
          join(runtimeRoot, `client${clientExtension}`),
        ),
        /\.tsx?$/.test(options.project.pagesAppPath) ? "ts" : "js",
      ),
      patchPagesError(
        options.project.pagesErrorPath,
        modulePath(
          options.project.pagesErrorPath,
          join(runtimeRoot, `pages-error${clientExtension}`),
        ),
      ),
    );
  }
  const middlewareOutcome = runtimeBoundaryOutcome(
    options.project.middlewarePath,
    "wrapMiddleware",
  );
  if (middlewareOutcome) outcomes.push(middlewareOutcome);
  if (options.project.proxyPath) {
    outcomes.push(
      patchProxy(
        options.project.proxyPath,
        modulePath(
          options.project.proxyPath,
          join(runtimeRoot, `server${runtimeExtension}`),
        ),
      ),
    );
  }
  const configPath =
    options.project.nextConfigPath ?? join(options.cwd, "next.config.mjs");
  outcomes.push(
    patchNextConfig(
      configPath,
      modulePath(configPath, commonJsBuildHelper),
      options.project.nextMajor,
      options.project.nextConfigPath === null,
    ),
    patchNextBuildScript(
      options.cwd,
      options.project.nextMajor,
      modulePath(
        join(options.cwd, "package.json"),
        join(runtimeRoot, "postbuild.cjs"),
      ),
    ),
  );

  const integration = createGeneratedIntegration(options.cwd, {
    recipe: "errors-nextjs-app-router",
    recipeVersion: NEXTJS_RECIPE_VERSION,
    files: generatedFiles,
  });
  const path = writeIntegration(
    options.cwd,
    ERRORS_NEXTJS_INTEGRATION,
    integration,
  );

  return {
    outcomes,
    runtimeRoot,
    generatedFiles,
    manifestPath: path,
  };
}
