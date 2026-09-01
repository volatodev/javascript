import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import type { FastApiProjectShape } from "../commands/init/detect-errors.js";
import { patchEnvValues, type PatchOutcome } from "../commands/init/patch.js";
import {
  createGeneratedIntegration,
  ERRORS_PYTHON_FASTAPI_INTEGRATION,
  modifiedGeneratedFiles,
  readManifest,
  writeIntegration,
} from "./manifest.js";

export const FASTAPI_RECIPE_VERSION = "0.1.0";

export type GenerateFastApiOptions = {
  cwd: string;
  dsn: string;
  project: FastApiProjectShape;
  sourceRoot?: string;
};

function assetsRoot(): string {
  const packaged = join(
    __dirname,
    "..",
    "skills",
    "volato-fastapi",
    "assets",
    "runtime",
  );
  if (existsSync(packaged)) return packaged;
  return join(
    __dirname,
    "..",
    "..",
    "skills",
    "volato-fastapi",
    "assets",
    "runtime",
  );
}

function copyRuntime(targetRoot: string, sourceRoot: string): string[] {
  if (!existsSync(sourceRoot)) {
    throw new Error(`FastAPI integration recipe assets are missing: ${sourceRoot}`);
  }
  return ["__init__.py", "runtime.py", "asgi.py"].map((name) => {
    const path = join(targetRoot, name);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, readFileSync(join(sourceRoot, name), "utf8"), "utf8");
    return path;
  });
}

function patchFastApiApplication(project: FastApiProjectShape): PatchOutcome {
  const path = project.entryPath;
  const original = readFileSync(path, "utf8");
  if (
    original.includes(
      "from volato_errors import VolatoASGIMiddleware, init_volato",
    ) &&
    original.includes("app.add_middleware(VolatoASGIMiddleware)")
  ) {
    return {
      path,
      status: "skipped",
      detail: "FastAPI ASGI capture already composes the root application",
    };
  }
  const suffix = [
    "",
    "# Volato Errors: dependency-free local ASGI capture.",
    "from volato_errors import VolatoASGIMiddleware, init_volato",
    "",
    "init_volato()",
    `${project.appVariable}.add_middleware(VolatoASGIMiddleware)`,
    "",
  ].join("\n");
  writeFileSync(path, `${original.trimEnd()}${suffix}`, "utf8");
  return {
    path,
    status: "updated",
    detail: "registered the outermost user ASGI middleware after application setup",
  };
}

export function generateFastApiIntegration(options: GenerateFastApiOptions): {
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
  const previous = manifest.integrations[ERRORS_PYTHON_FASTAPI_INTEGRATION];
  if (previous) {
    const modified = modifiedGeneratedFiles(options.cwd, previous);
    if (modified.length > 0) {
      throw new Error(
        `Generated Volato FastAPI files were edited or deleted: ${modified.join(", ")}. Review those changes before updating the integration.`,
      );
    }
  }
  const runtimeRoot = join(options.cwd, "volato_errors");
  const generatedFiles = copyRuntime(
    runtimeRoot,
    options.sourceRoot ?? assetsRoot(),
  );
  const outcomes = [
    patchEnvValues(
      options.cwd,
      [{ key: "VOLATO_DSN", value: options.dsn }],
      false,
    ),
    patchFastApiApplication(options.project),
  ];
  const integration = createGeneratedIntegration(options.cwd, {
    recipe: "errors-python-fastapi",
    recipeVersion: FASTAPI_RECIPE_VERSION,
    files: generatedFiles,
  });
  const manifestPath = writeIntegration(
    options.cwd,
    ERRORS_PYTHON_FASTAPI_INTEGRATION,
    integration,
  );
  return { outcomes, runtimeRoot, generatedFiles, manifestPath };
}
