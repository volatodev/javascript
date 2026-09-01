import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import type { AngularProjectShape } from "../commands/init/detect-errors.js";
import {
  patchEnvValues,
  type PatchOutcome,
} from "../commands/init/patch.js";
import { BROWSER_JAVASCRIPT_RUNTIME } from "../generated/browser-javascript-runtime.js";
import { browserModulePath } from "./browser.js";
import {
  createGeneratedIntegration,
  ERRORS_BROWSER_ANGULAR_INTEGRATION,
  modifiedGeneratedFiles,
  readManifest,
  writeIntegration,
} from "./manifest.js";

export const ANGULAR_RECIPE_VERSION = "0.1.0";

export type GenerateAngularOptions = {
  cwd: string;
  dsn: string;
  ingestToken?: string;
  project: AngularProjectShape;
  sourceRoot?: string;
};

function sharedAssetsRoot(): string {
  const packaged = join(__dirname, "..", "skills", "_shared", "errors-browser");
  if (existsSync(packaged)) return packaged;
  return join(
    __dirname,
    "..",
    "..",
    "skills",
    "_shared",
    "errors-browser",
  );
}

function angularAssetsRoot(): string {
  const packaged = join(
    __dirname,
    "..",
    "skills",
    "volato-angular",
    "assets",
    "runtime",
  );
  if (existsSync(packaged)) return packaged;
  return join(
    __dirname,
    "..",
    "..",
    "skills",
    "volato-angular",
    "assets",
    "runtime",
  );
}

function copyRuntime(
  targetRoot: string,
  angularSourceRoot = angularAssetsRoot(),
): string[] {
  const sharedRoot = sharedAssetsRoot();
  if (!existsSync(sharedRoot) || !existsSync(angularSourceRoot)) {
    throw new Error("Angular integration recipe assets are missing.");
  }
  const files = [
    ["browser.ts", readFileSync(join(sharedRoot, "browser.ts"), "utf8")],
    ["angular.ts", readFileSync(join(angularSourceRoot, "angular.ts"), "utf8")],
    ["artifact.mjs", BROWSER_JAVASCRIPT_RUNTIME["artifact.mjs"]],
    [
      "angular-build.mjs",
      readFileSync(join(angularSourceRoot, "angular-build.mjs"), "utf8"),
    ],
  ] as const;
  return files.map(([name, source]) => {
    if (source === undefined) {
      throw new Error(`Generated Angular runtime is missing: ${name}`);
    }
    const path = join(targetRoot, name);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, source, "utf8");
    return path;
  });
}

function patchApplicationConfig(
  project: AngularProjectShape,
  runtimeRoot: string,
): PatchOutcome {
  const path = project.appConfigPath;
  const original = readFileSync(path, "utf8");
  if (original.includes("provideVolatoAngular")) {
    return {
      path,
      status: "skipped",
      detail: "Angular ErrorHandler composition already installed",
    };
  }
  const providers = /(providers\s*:\s*\[)(\s*)/;
  if (!providers.test(original)) {
    return {
      path,
      status: "manual",
      detail: "ApplicationConfig no longer has one static providers array",
    };
  }
  const modulePath = browserModulePath(path, join(runtimeRoot, "angular"));
  const importLine = `import { provideVolatoAngular } from ${JSON.stringify(modulePath)};\n`;
  const next = `${importLine}${original.replace(
    providers,
    (_match, opening: string, whitespace: string) =>
      `${opening}${whitespace || "\n  "}provideVolatoAngular(),${whitespace || "\n  "}`,
  )}`;
  writeFileSync(path, next, "utf8");
  return {
    path,
    status: "updated",
    detail: "composed browser capture with the resolved root ErrorHandler",
  };
}

function patchAngularSourceMaps(project: AngularProjectShape): PatchOutcome {
  const path = project.angularConfigPath;
  const workspace = JSON.parse(readFileSync(path, "utf8")) as Record<
    string,
    any
  >;
  const production =
    workspace.projects[project.projectName].architect.build.configurations
      .production;
  const expected = {
    scripts: true,
    styles: false,
    hidden: true,
    sourcesContent: true,
  };
  if (JSON.stringify(production.sourceMap) === JSON.stringify(expected)) {
    return {
      path,
      status: "skipped",
      detail: "Angular production maps are already private and addressable",
    };
  }
  production.sourceMap = expected;
  writeFileSync(path, `${JSON.stringify(workspace, null, 2)}\n`, "utf8");
  return {
    path,
    status: "updated",
    detail: "enabled hidden production script maps for private upload",
  };
}

function patchAngularBuildScript(cwd: string): PatchOutcome {
  const path = join(cwd, "package.json");
  const pkg = JSON.parse(readFileSync(path, "utf8")) as Record<string, any>;
  if (pkg.scripts.build === "node src/volato/angular-build.mjs") {
    return {
      path,
      status: "skipped",
      detail: "Angular production build already injects release and uploads maps",
    };
  }
  if (pkg.scripts.build !== "ng build") {
    return {
      path,
      status: "manual",
      detail: "custom Angular build script cannot be replaced automatically",
    };
  }
  pkg.scripts.build = "node src/volato/angular-build.mjs";
  writeFileSync(path, `${JSON.stringify(pkg, null, 2)}\n`, "utf8");
  return {
    path,
    status: "updated",
    detail: "preserved Angular CLI build with release injection and map upload",
  };
}

function assertComposable(options: GenerateAngularOptions): void {
  const config = readFileSync(options.project.appConfigPath, "utf8");
  if (
    !config.includes("provideVolatoAngular") &&
    !/providers\s*:\s*\[/.test(config)
  ) {
    throw new Error(
      "Angular ApplicationConfig cannot be composed statically; no files were modified.",
    );
  }
  const pkg = JSON.parse(
    readFileSync(join(options.cwd, "package.json"), "utf8"),
  ) as Record<string, any>;
  if (
    pkg.scripts?.build !== "ng build" &&
    pkg.scripts?.build !== "node src/volato/angular-build.mjs"
  ) {
    throw new Error(
      "Angular package build script cannot be composed exactly; no files were modified.",
    );
  }
}

export function generateAngularIntegration(options: GenerateAngularOptions): {
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
  const previous = manifest.integrations[ERRORS_BROWSER_ANGULAR_INTEGRATION];
  if (previous) {
    const modified = modifiedGeneratedFiles(options.cwd, previous);
    if (modified.length > 0) {
      throw new Error(
        `Generated Volato Angular files were edited or deleted: ${modified.join(", ")}. Review those changes before updating the integration.`,
      );
    }
  }
  assertComposable(options);

  const runtimeRoot = join(options.cwd, "src", "volato");
  const generatedFiles = copyRuntime(runtimeRoot, options.sourceRoot);
  const outcomes = [
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
    patchAngularSourceMaps(options.project),
    patchAngularBuildScript(options.cwd),
    patchApplicationConfig(options.project, runtimeRoot),
  ];
  if (outcomes.some((outcome) => outcome.status === "manual")) {
    throw new Error(
      "Angular integration unexpectedly required manual composition after detection.",
    );
  }
  const integration = createGeneratedIntegration(options.cwd, {
    recipe: "errors-browser-angular",
    recipeVersion: ANGULAR_RECIPE_VERSION,
    files: generatedFiles,
  });
  const manifestPath = writeIntegration(
    options.cwd,
    ERRORS_BROWSER_ANGULAR_INTEGRATION,
    integration,
  );
  return { outcomes, runtimeRoot, generatedFiles, manifestPath };
}
