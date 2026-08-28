import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve } from "node:path";
import { detectProject, type ProjectShape } from "./detect.js";

export type SourceLanguage = "ts" | "js";
export type BrowserBuildAdapter = "vite" | "webpack" | "rspack";
export type NodeModuleFormat = "esm" | "cjs";
export type NodeProcessShape = "server" | "job" | "script";
export type ExpressTopology = "same-file" | "split-bootstrap";
export type FastifyTopology = "same-file" | "split-bootstrap";
export type NodeInvocationHandlerShape =
  | "async-handler"
  | "node-http-handler";

export type BrowserProjectShape = {
  cwd: string;
  entryPath: string;
  buildConfigPath: string;
  buildAdapter: BrowserBuildAdapter;
  language: SourceLanguage;
};

export type BrowserReactProjectShape = BrowserProjectShape;

export type ViteReactProjectShape = BrowserReactProjectShape & {
  buildAdapter: "vite";
  viteConfigPath: string;
};

export type ViteVueProjectShape = BrowserProjectShape & {
  buildAdapter: "vite";
  viteConfigPath: string;
  appVariable: string;
};

export type ViteSvelteProjectShape = BrowserProjectShape & {
  buildAdapter: "vite";
  viteConfigPath: string;
  rootComponentPath: string;
  rootComponentVariable: string;
};

export type AngularProjectShape = {
  cwd: string;
  projectName: string;
  entryPath: string;
  appConfigPath: string;
  angularConfigPath: string;
  angularVersion: 20 | 21 | 22;
  buildAdapter: "angular";
  changeDetection: "zonejs" | "zoneless";
  language: "ts";
  outputRoot: string;
};

export type FastApiProjectShape = {
  cwd: string;
  entryPath: string;
  appVariable: "app";
  pythonVersion: "3.10" | "3.11" | "3.12" | "3.13" | "3.14";
  fastapiVersion: "0.141.1";
  starletteVersion: "1.6.0";
  uvicornVersion: "0.52.4";
  topology: "module-app";
};

export type NuxtConfigFormat = "ts" | "js" | "mjs";

export type NuxtProjectShape = {
  cwd: string;
  configPath: string;
  configFormat: NuxtConfigFormat;
  language: SourceLanguage;
  nodeVersion: "22.23.2" | "24.19.0";
  nuxtVersion: "4.5.2";
  nitroVersion: "2.13.4";
  vueVersion: "3.5.42";
  viteVersion: "8.2.2";
  outputRoot: string;
};

export type NodeProjectShape = {
  cwd: string;
  entryPath: string;
  express: boolean;
  language: SourceLanguage;
  module: NodeModuleFormat;
  processShape: NodeProcessShape;
  expressVersion?: 4 | 5;
  expressTopology?: ExpressTopology;
  expressAppPath?: string;
  expressUnsupportedReason?: string;
};

export type FastifyProjectShape = NodeProjectShape & {
  express: false;
  processShape: "server";
  fastifyVersion: 5;
  topology: FastifyTopology;
  appPath: string;
  appVariable: string;
};

export type NestHttpTransport = "express" | "fastify";

export type NestProjectShape = NodeProjectShape & {
  express: false;
  processShape: "server";
  nestVersion: 11 | 12;
  transport: NestHttpTransport;
  transportVersion: 5;
  appVariable: string;
};

export type NodeInvocationProjectShape = {
  cwd: string;
  handlerPath: string;
  handlerShape: NodeInvocationHandlerShape;
  language: SourceLanguage;
  module: NodeModuleFormat;
};

export type ErrorsStackShape = {
  cwd: string;
  nextjs?: ProjectShape;
  nuxt?: NuxtProjectShape;
  browserReact?: BrowserReactProjectShape;
  viteReact?: ViteReactProjectShape;
  browserVue?: ViteVueProjectShape;
  browserSvelte?: ViteSvelteProjectShape;
  angular?: AngularProjectShape;
  fastapi?: FastApiProjectShape;
  node?: NodeProjectShape;
  fastify?: FastifyProjectShape;
  nest?: NestProjectShape;
  nodeInvocation?: NodeInvocationProjectShape;
  notices: string[];
};

export class ErrorsStackDetectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ErrorsStackDetectionError";
  }
}

type PackageJson = Record<string, unknown>;

const UNSUPPORTED_BACKEND_MANIFESTS = [
  {
    label: "Python",
    files: ["pyproject.toml", "requirements.txt", "Pipfile"],
  },
  { label: "Go", files: ["go.mod"] },
  { label: "PHP", files: ["composer.json"] },
] as const;

const UNSUPPORTED_HTTP_FRAMEWORKS = [
  ["hono", "Hono"],
] as const;

function readPackageJson(cwd: string): PackageJson {
  const path = join(cwd, "package.json");
  if (!existsSync(path)) {
    throw new ErrorsStackDetectionError(
      `No package.json found in ${cwd}. Run setup from an application root.`,
    );
  }
  try {
    const value = JSON.parse(readFileSync(path, "utf8")) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("package.json is not an object");
    }
    return value as PackageJson;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new ErrorsStackDetectionError(`Cannot read ${path}: ${detail}`);
  }
}

const FASTAPI_DEPENDENCIES = {
  fastapi: "0.141.1",
  starlette: "1.6.0",
  uvicorn: "0.52.4",
  pydantic: "2.13.5",
  anyio: "4.14.2",
} as const;

const NUXT_DEPENDENCIES = {
  nuxt: "4.5.2",
  "@nuxt/nitro-server": "4.5.2",
  "@nuxt/vite-builder": "4.5.2",
  nitropack: "2.13.4",
  vue: "3.5.42",
  "vue-router": "5.2.0",
  vite: "8.2.2",
} as const;

const NUXT_NODE_VERSIONS = ["22.23.2", "24.19.0"] as const;
const NUXT_BUILD_COMMAND = "nuxt build";
const NUXT_GENERATED_BUILD_COMMAND =
  "nuxt build && node volato-nuxt/upload-sourcemaps.mjs .output";

function packageVersion(path: string): string | null {
  try {
    const value = JSON.parse(readFileSync(path, "utf8")) as {
      version?: unknown;
    };
    return typeof value.version === "string" ? value.version : null;
  } catch {
    return null;
  }
}

function resolvePackageVersion(
  requireFrom: ReturnType<typeof createRequire>,
  name: string,
): { path: string; version: string } | null {
  try {
    const path = requireFrom.resolve(`${name}/package.json`);
    const version = packageVersion(path);
    return version ? { path, version } : null;
  } catch {
    return null;
  }
}

function exactNuxtRuntimeVersions(cwd: string): typeof NUXT_DEPENDENCIES {
  const rootRequire = createRequire(join(cwd, "package.json"));
  const nuxt = resolvePackageVersion(rootRequire, "nuxt");
  if (!nuxt) {
    throw new ErrorsStackDetectionError(
      "Nuxt dependencies are not installed, so the exact private calibration tuple cannot be verified; install the application dependencies and no files were modified.",
    );
  }
  const nuxtRequire = createRequire(nuxt.path);
  const nitroServer = resolvePackageVersion(
    nuxtRequire,
    "@nuxt/nitro-server",
  );
  const viteBuilder = resolvePackageVersion(nuxtRequire, "@nuxt/vite-builder");
  const resolved = {
    nuxt,
    "@nuxt/nitro-server": nitroServer,
    "@nuxt/vite-builder": viteBuilder,
    nitropack: nitroServer
      ? resolvePackageVersion(createRequire(nitroServer.path), "nitropack")
      : null,
    vue: resolvePackageVersion(nuxtRequire, "vue"),
    "vue-router": resolvePackageVersion(nuxtRequire, "vue-router"),
    vite: viteBuilder
      ? resolvePackageVersion(createRequire(viteBuilder.path), "vite")
      : null,
  } satisfies Record<keyof typeof NUXT_DEPENDENCIES, {
    path: string;
    version: string;
  } | null>;
  const labels: Record<keyof typeof NUXT_DEPENDENCIES, string> = {
    nuxt: "Nuxt",
    "@nuxt/nitro-server": "Nuxt Nitro server",
    "@nuxt/vite-builder": "Nuxt Vite builder",
    nitropack: "Nitro",
    vue: "Vue",
    "vue-router": "Vue Router",
    vite: "Vite",
  };
  for (const [name, expected] of Object.entries(NUXT_DEPENDENCIES) as Array<
    [keyof typeof NUXT_DEPENDENCIES, string]
  >) {
    const actual = resolved[name]?.version;
    if (actual !== expected) {
      throw new ErrorsStackDetectionError(
        `${labels[name]} ${actual ?? "could not be resolved"} is outside the private Nuxt calibration, which requires ${expected}; no files were modified.`,
      );
    }
  }
  return NUXT_DEPENDENCIES;
}

function configProperty(source: string, name: string): RegExp {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|[,{])\\s*(?:["']${escaped}["']|${escaped})\\s*:`, "m");
}

function nuxtShape(
  cwd: string,
  pkg: PackageJson,
  deps: Record<string, string>,
): NuxtProjectShape {
  const declaredNuxt = deps.nuxt;
  if (declaredNuxt !== NUXT_DEPENDENCIES.nuxt) {
    throw new ErrorsStackDetectionError(
      `Nuxt ${declaredNuxt ?? "unknown"} is not supported by the frozen 4.5.2 calibration; pin Nuxt exactly and no files were modified.`,
    );
  }
  for (const name of ["vue", "vue-router"] as const) {
    if (deps[name] !== NUXT_DEPENDENCIES[name]) {
      throw new ErrorsStackDetectionError(
        `${name === "vue" ? "Vue" : "Vue Router"} must be pinned exactly to ${NUXT_DEPENDENCIES[name]} for the private Nuxt calibration; found ${deps[name] ?? "no exact pin"} and no files were modified.`,
      );
    }
  }

  const installed = exactNuxtRuntimeVersions(cwd);
  const nodeVersion = existsSync(join(cwd, ".node-version"))
    ? readFileSync(join(cwd, ".node-version"), "utf8").trim()
    : "";
  if (!(NUXT_NODE_VERSIONS as readonly string[]).includes(nodeVersion)) {
    throw new ErrorsStackDetectionError(
      `Node ${nodeVersion || "unknown"} is outside the private Nuxt calibration; .node-version must be exactly 22.23.2 or 24.19.0 and no files were modified.`,
    );
  }
  const engines =
    pkg.engines && typeof pkg.engines === "object" && !Array.isArray(pkg.engines)
      ? (pkg.engines as Record<string, unknown>)
      : null;
  if (engines?.node !== nodeVersion) {
    throw new ErrorsStackDetectionError(
      `Nuxt calibration requires package.json engines.node = ${JSON.stringify(nodeVersion)} to match .node-version exactly; no files were modified.`,
    );
  }
  if (pkg.type !== "module") {
    throw new ErrorsStackDetectionError(
      "Nuxt calibration requires a package with type: module; no files were modified.",
    );
  }
  if (pkg.workspaces) {
    throw new ErrorsStackDetectionError(
      "Nuxt monorepo and multi-application roots are not supported by the private calibration; run from one conventional application root and no files were modified.",
    );
  }

  const scripts =
    pkg.scripts && typeof pkg.scripts === "object" && !Array.isArray(pkg.scripts)
      ? (pkg.scripts as Record<string, unknown>)
      : null;
  if (
    scripts?.build !== NUXT_BUILD_COMMAND &&
    scripts?.build !== NUXT_GENERATED_BUILD_COMMAND
  ) {
    throw new ErrorsStackDetectionError(
      "Nuxt calibration requires the conventional `nuxt build` production command; custom build, generate and deployment commands are not modified automatically.",
    );
  }

  const supportedConfigs = [
    "nuxt.config.ts",
    "nuxt.config.js",
    "nuxt.config.mjs",
  ].filter((name) => existsSync(join(cwd, name)));
  const otherConfigs = ["nuxt.config.mts", "nuxt.config.cjs"].filter((name) =>
    existsSync(join(cwd, name)),
  );
  if (supportedConfigs.length !== 1 || otherConfigs.length > 0) {
    const found = [...supportedConfigs, ...otherConfigs];
    throw new ErrorsStackDetectionError(
      `${found.length === 0 ? "No" : `Multiple or unsupported (${found.join(", ")})`} Nuxt config was detected; exactly one nuxt.config.ts, nuxt.config.js or nuxt.config.mjs is required and no files were modified.`,
    );
  }
  const configName = supportedConfigs[0]!;
  const configPath = join(cwd, configName);
  const source = readFileSync(configPath, "utf8");
  if (
    (source.match(/\bexport\s+default\b/g) ?? []).length !== 1 ||
    !/export\s+default\s+(?:withVolatoNuxt\(\s*)?defineNuxtConfig\(\s*\{[\s\S]*\}\s*\)\s*\)?\s*;?\s*$/.test(
      source,
    )
  ) {
    throw new ErrorsStackDetectionError(
      "Nuxt calibration requires one static defineNuxtConfig object export; dynamic configuration was not modified and no files were modified.",
    );
  }
  if (configProperty(source, "routeRules").test(source)) {
    throw new ErrorsStackDetectionError(
      "Nuxt route rules and hybrid rendering are outside the private calibration; no files were modified.",
    );
  }
  if (configProperty(source, "ssr").test(source) && /\bssr\s*:\s*false\b/.test(source)) {
    throw new ErrorsStackDetectionError(
      "Nuxt `ssr: false` is not supported by the private full-stack calibration; no files were modified.",
    );
  }
  if (configProperty(source, "builder").test(source)) {
    throw new ErrorsStackDetectionError(
      "Nuxt calibration requires the default Vite builder; explicit or custom builders were not modified and no files were modified.",
    );
  }
  if (
    ["extends", "srcDir", "workspaceDir", "multiApp"].some((name) =>
      configProperty(source, name).test(source),
    ) ||
    existsSync(join(cwd, ".nuxtrc")) ||
    existsSync(join(cwd, "layers"))
  ) {
    throw new ErrorsStackDetectionError(
      "Nuxt layers, custom source roots and multi-app layouts are not supported by the private calibration; no files were modified.",
    );
  }
  if (
    ["prerender", "isr", "static"].some((name) =>
      configProperty(source, name).test(source),
    )
  ) {
    throw new ErrorsStackDetectionError(
      "Nuxt prerender, ISR and static output are outside the long-lived Node calibration; no files were modified.",
    );
  }
  const preset = /\bpreset\s*:\s*["']([^"']+)["']/.exec(source)?.[1];
  if (preset !== "node-server") {
    throw new ErrorsStackDetectionError(
      `Nuxt calibration requires an explicit node-server preset; found ${preset ?? "no preset"} and no files were modified.`,
    );
  }
  if (!existsSync(join(cwd, "app", "app.vue"))) {
    throw new ErrorsStackDetectionError(
      "Nuxt calibration requires the conventional app/app.vue root; custom application roots were not modified and no files were modified.",
    );
  }

  const configFormat = configName.slice("nuxt.config.".length) as NuxtConfigFormat;
  return {
    cwd,
    configPath,
    configFormat,
    language: configFormat === "ts" ? "ts" : "js",
    nodeVersion: nodeVersion as NuxtProjectShape["nodeVersion"],
    nuxtVersion: installed.nuxt,
    nitroVersion: installed.nitropack,
    vueVersion: installed.vue,
    viteVersion: installed.vite,
    outputRoot: join(cwd, ".output"),
  };
}

function exactPythonDependency(source: string, name: string): string | null {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|["'\\s])${escaped}==([0-9]+(?:\\.[0-9]+){1,3})(?=["'\\s,;]|$)`, "mi")
    .exec(source)?.[1] ?? null;
}

function fastApiShape(cwd: string): FastApiProjectShape {
  const pyprojectPath = join(cwd, "pyproject.toml");
  const requirementsPath = join(cwd, "requirements.txt");
  const pythonVersionPath = join(cwd, ".python-version");
  const entryPath = join(cwd, "app.py");
  if (!existsSync(pyprojectPath) || !existsSync(pythonVersionPath)) {
    throw new ErrorsStackDetectionError(
      "FastAPI private calibration requires pyproject.toml and one exact .python-version at the application root; no files were modified.",
    );
  }
  const manifest = [
    readFileSync(pyprojectPath, "utf8"),
    existsSync(requirementsPath) ? readFileSync(requirementsPath, "utf8") : "",
  ].join("\n");
  const pythonVersion = readFileSync(pythonVersionPath, "utf8").trim();
  if (!["3.10", "3.11", "3.12", "3.13", "3.14"].includes(pythonVersion)) {
    throw new ErrorsStackDetectionError(
      `Python ${pythonVersion || "unknown"} is not supported by the private FastAPI calibration; maintained Python 3.10-3.14 is required and no files were modified.`,
    );
  }
  const declaredPython = /requires-python\s*=\s*["']==([^"']+)\.\*["']/i.exec(
    manifest,
  )?.[1];
  if (declaredPython !== pythonVersion) {
    throw new ErrorsStackDetectionError(
      `FastAPI calibration requires requires-python = "==${pythonVersion}.*" to match .python-version exactly; no files were modified.`,
    );
  }
  const fastapi = exactPythonDependency(manifest, "fastapi");
  if (!fastapi) {
    if (/\bstarlette\b/i.test(manifest)) {
      throw new ErrorsStackDetectionError(
        "A direct Starlette application was detected; direct Starlette is not supported by the private FastAPI calibration and no files were modified.",
      );
    }
    throw new ErrorsStackDetectionError(
      "FastAPI was not pinned exactly in the Python application manifest; no files were modified.",
    );
  }
  if (fastapi !== FASTAPI_DEPENDENCIES.fastapi) {
    throw new ErrorsStackDetectionError(
      `FastAPI ${fastapi} is not supported by the frozen 0.141.1 calibration; no files were modified.`,
    );
  }
  for (const name of ["starlette", "uvicorn", "pydantic", "anyio"] as const) {
    const actual = exactPythonDependency(manifest, name);
    if (actual !== FASTAPI_DEPENDENCIES[name]) {
      throw new ErrorsStackDetectionError(
        `${name} must be pinned exactly to ${FASTAPI_DEPENDENCIES[name]} for this private calibration; found ${actual ?? "no exact pin"} and no files were modified.`,
      );
    }
  }
  if (!existsSync(entryPath)) {
    throw new ErrorsStackDetectionError(
      "FastAPI was detected without the conventional app.py module; app factories and alternate entries are not supported and no files were modified.",
    );
  }
  const source = readFileSync(entryPath, "utf8");
  const instances = source.match(
    /^\s*[A-Za-z_]\w*\s*=\s*FastAPI\s*\([^\n]*\)\s*$/gm,
  ) ?? [];
  if (instances.length !== 1) {
    throw new ErrorsStackDetectionError(
      `FastAPI calibration requires exactly one module-level app = FastAPI(...) statement; found ${instances.length} and no files were modified.`,
    );
  }
  if (!/^\s*app\s*=\s*FastAPI\s*\([^\n]*\)\s*$/m.test(source)) {
    throw new ErrorsStackDetectionError(
      "FastAPI calibration requires the conventional module-level app = FastAPI(...) bootstrap; no files were modified.",
    );
  }
  const unsupported: Array<[RegExp, string]> = [
    [/\b(?:BackgroundTasks?|BackgroundTask)\b/, "background-task failures are not supported"],
    [/\b(?:WebSocket|websocket)\b/, "WebSocket lifecycle is not supported"],
    [/\b(?:StreamingResponse|EventSourceResponse)\b/, "streaming/SSE lifecycle is not supported"],
    [/\blifespan\s*=/, "lifespan failures are not supported"],
    [/\bapp\.mount\s*\(/, "mounted or nested applications are not supported"],
    [/\buvicorn\.run\s*\(/, "in-module Uvicorn bootstrap is not supported"],
  ];
  for (const [pattern, reason] of unsupported) {
    if (pattern.test(source)) {
      throw new ErrorsStackDetectionError(
        `FastAPI ${reason} by the frozen HTTP calibration; no files were modified.`,
      );
    }
  }
  return {
    cwd,
    entryPath,
    appVariable: "app",
    pythonVersion: pythonVersion as FastApiProjectShape["pythonVersion"],
    fastapiVersion: FASTAPI_DEPENDENCIES.fastapi,
    starletteVersion: FASTAPI_DEPENDENCIES.starlette,
    uvicornVersion: FASTAPI_DEPENDENCIES.uvicorn,
    topology: "module-app",
  };
}

function dependencies(pkg: PackageJson): Record<string, string> {
  const result: Record<string, string> = {};
  for (const field of ["dependencies", "devDependencies"] as const) {
    const value = pkg[field];
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    for (const [name, version] of Object.entries(value)) {
      if (typeof version === "string") result[name] = version;
    }
  }
  return result;
}

function firstExisting(cwd: string, paths: string[]): string | null {
  return paths.map((path) => join(cwd, path)).find(existsSync) ?? null;
}

function unsupportedBackendLabels(cwd: string): string[] {
  const roots = [cwd, join(cwd, "backend"), join(cwd, "server"), join(cwd, "api")];
  return UNSUPPORTED_BACKEND_MANIFESTS.filter(({ files }) =>
    roots.some((root) => files.some((file) => existsSync(join(root, file)))),
  ).map(({ label }) => label);
}

function languageOf(path: string): SourceLanguage {
  return /\.[cm]?tsx?$/.test(path) ? "ts" : "js";
}

const BROWSER_BUILD_ADAPTERS: Array<{
  adapter: BrowserBuildAdapter;
  label: string;
  dependencies: string[];
  configs: string[];
}> = [
  {
    adapter: "vite",
    label: "Vite",
    dependencies: ["vite"],
    configs: ["vite.config.ts", "vite.config.mts", "vite.config.js", "vite.config.mjs"],
  },
  {
    adapter: "webpack",
    label: "Webpack",
    dependencies: ["webpack"],
    configs: ["webpack.config.mjs", "webpack.config.cjs"],
  },
  {
    adapter: "rspack",
    label: "Rspack",
    dependencies: ["@rspack/core", "@rspack/cli"],
    configs: ["rspack.config.mjs", "rspack.config.ts"],
  },
];

function browserBuildShape(
  cwd: string,
  deps: Record<string, string>,
): BrowserProjectShape | undefined {
  const installed = BROWSER_BUILD_ADAPTERS.filter(({ dependencies }) =>
    dependencies.some((dependency) => typeof deps[dependency] === "string"),
  );
  if (installed.length === 0) return undefined;
  const configured = installed.flatMap((candidate) =>
    candidate.configs
      .filter((config) => existsSync(join(cwd, config)))
      .map((config) => ({ ...candidate, config })),
  );
  if (configured.length > 1) {
    throw new ErrorsStackDetectionError(
      `Multiple browser build configurations were detected (${configured.map(({ config }) => config).join(", ")}). Select one application/build root explicitly; no files were modified.`,
    );
  }
  const selected = configured[0];
  if (!selected) {
    if (installed.length > 1) {
      throw new ErrorsStackDetectionError(
        `Multiple browser build tools are installed (${installed.map(({ label }) => label).join(", ")}), but no supported configuration identifies the deployed target. Select one application/build root explicitly; no files were modified.`,
      );
    }
    const candidate = installed[0]!;
    throw new ErrorsStackDetectionError(
      `${candidate.label} was detected, but Volato could not find a supported ${candidate.configs.join(" or ")}. No files were modified.`,
    );
  }
  const entryPath = firstExisting(cwd, [
    "src/main.tsx",
    "src/main.jsx",
    "src/main.ts",
    "src/main.js",
  ]);
  if (!entryPath) {
    throw new ErrorsStackDetectionError(
      `${selected.label} was detected, but Volato could not find src/main.{tsx,jsx,ts,js}. No files were modified.`,
    );
  }
  return {
    cwd,
    entryPath,
    buildConfigPath: join(cwd, selected.config),
    buildAdapter: selected.adapter,
    language: languageOf(entryPath),
  };
}

function browserShapes(
  cwd: string,
  deps: Record<string, string>,
): {
  browserReact?: BrowserReactProjectShape;
  browserVue?: ViteVueProjectShape;
  browserSvelte?: ViteSvelteProjectShape;
} {
  const build = browserBuildShape(cwd, deps);
  if (!build) return {};

  const renderers = ["react", "vue", "svelte"].filter(
    (renderer) => typeof deps[renderer] === "string",
  );
  if (renderers.length > 1) {
    throw new ErrorsStackDetectionError(
      `Multiple browser renderers were detected (${renderers.join(", ")}). Select one application root explicitly; no files were modified.`,
    );
  }
  if (renderers[0] === "react") return { browserReact: build };

  if (renderers[0] === "vue") {
    if (build.buildAdapter !== "vite") {
      throw new ErrorsStackDetectionError(
        `Vue 3 browser capture currently requires Vite; ${build.buildAdapter} was not modified.`,
      );
    }
    if (dependencyMajor(deps.vue!) !== 3) {
      throw new ErrorsStackDetectionError(
        "Vue 2 browser capture is not supported; no files were modified.",
      );
    }
    if (typeof deps.nuxt === "string") {
      throw new ErrorsStackDetectionError(
        "Nuxt and Vue SSR capture are not supported by the Vite + Vue SPA recipe; no files were modified.",
      );
    }
    const source = readFileSync(build.entryPath, "utf8");
    if (/\bcreateSSRApp\s*\(/.test(source)) {
      throw new ErrorsStackDetectionError(
        "createSSRApp is not supported by the Vite + Vue SPA recipe; no files were modified.",
      );
    }
    const createCalls = source.match(/\bcreateApp\s*\(/g) ?? [];
    const assignments = [
      ...source.matchAll(
        /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*createApp\s*\(/g,
      ),
    ];
    const appVariable = assignments[0]?.[1];
    const mountCalls = appVariable
      ? source.match(
          new RegExp(`\\b${appVariable.replace(/[$]/g, "\\$")}\\.mount\\s*\\(`, "g"),
        ) ?? []
      : [];
    if (
      createCalls.length !== 1 ||
      assignments.length !== 1 ||
      !appVariable ||
      mountCalls.length !== 1
    ) {
      throw new ErrorsStackDetectionError(
        "Vite + Vue setup requires exactly one named createApp root and one matching mount call; no files were modified.",
      );
    }
    return {
      browserVue: {
        ...build,
        buildAdapter: "vite",
        viteConfigPath: build.buildConfigPath,
        appVariable,
      },
    };
  }

  if (renderers[0] === "svelte") {
    if (build.buildAdapter !== "vite") {
      throw new ErrorsStackDetectionError(
        `Svelte 5 browser capture currently requires Vite; ${build.buildAdapter} was not modified.`,
      );
    }
    if (dependencyMajor(deps.svelte!) !== 5) {
      throw new ErrorsStackDetectionError(
        "Svelte 4 browser capture is not supported; no files were modified.",
      );
    }
    if (typeof deps["@sveltejs/kit"] === "string") {
      throw new ErrorsStackDetectionError(
        "SvelteKit and Svelte SSR capture are not supported by the Vite + Svelte SPA recipe; no files were modified.",
      );
    }
    const source = readFileSync(build.entryPath, "utf8");
    if (/\bhydrate\s*\(/.test(source)) {
      throw new ErrorsStackDetectionError(
        "Svelte hydrate is not supported by the Vite + Svelte SPA recipe; no files were modified.",
      );
    }
    const mountCalls = source.match(/\bmount\s*\(/g) ?? [];
    const rootImport =
      /import\s+([A-Za-z_$][\w$]*)\s+from\s+["']([^"']+\.svelte)["']/.exec(
        source,
      );
    const rootVariable = rootImport?.[1];
    if (
      mountCalls.length !== 1 ||
      !rootVariable ||
      !new RegExp(`\\bmount\\s*\\(\\s*${rootVariable.replace(/[$]/g, "\\$")}\\b`).test(
        source,
      )
    ) {
      throw new ErrorsStackDetectionError(
        "Vite + Svelte setup requires exactly one static mount of one imported .svelte root; no files were modified.",
      );
    }
    const rootComponentPath = resolve(dirname(build.entryPath), rootImport[2]!);
    if (!existsSync(rootComponentPath)) {
      throw new ErrorsStackDetectionError(
        `The Svelte root ${rootImport[2]} does not exist; no files were modified.`,
      );
    }
    const rootSource = readFileSync(rootComponentPath, "utf8");
    if (
      /<svelte:boundary\b/.test(rootSource) &&
      !rootSource.includes("captureVolatoSvelteError")
    ) {
      throw new ErrorsStackDetectionError(
        "An existing Svelte boundary requires explicit fallback/reset composition; no files were modified.",
      );
    }
    if (/\bexport\s+(?:let|const|function|class)\b/.test(rootSource)) {
      throw new ErrorsStackDetectionError(
        "An exported Svelte component API cannot be preserved by the root boundary wrapper; no files were modified.",
      );
    }
    const leadingScripts = /^(?:\s*<script\b[^>]*>[\s\S]*?<\/script>\s*)*/.exec(
      rootSource,
    )?.[0] ?? "";
    const afterScripts = rootSource.slice(leadingScripts.length);
    const trailingStyles = /(?:\s*<style\b[^>]*>[\s\S]*?<\/style>\s*)*$/.exec(
      afterScripts,
    )?.[0] ?? "";
    const markup = afterScripts.slice(
      0,
      afterScripts.length - trailingStyles.length,
    );
    if (!markup.trim() || /<(?:script|style)\b/.test(markup)) {
      throw new ErrorsStackDetectionError(
        "The Svelte root must keep instance/module scripts before markup and styles after markup for deterministic boundary composition; no files were modified.",
      );
    }
    return {
      browserSvelte: {
        ...build,
        buildAdapter: "vite",
        viteConfigPath: build.buildConfigPath,
        rootComponentPath,
        rootComponentVariable: rootVariable,
      },
    };
  }

  const renderer = renderers[0] ?? "an unknown renderer";
  throw new ErrorsStackDetectionError(
    `${build.buildAdapter} + ${renderer} browser capture is not supported in this release; no files were modified.`,
  );
}

type AngularBuildTarget = {
  builder?: unknown;
  options?: unknown;
  configurations?: unknown;
  defaultConfiguration?: unknown;
};

function objectRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function angularAppConfigPath(cwd: string, entryPath: string): string {
  const entry = readFileSync(entryPath, "utf8");
  const bootstrapCalls = entry.match(/\bbootstrapApplication\s*\(/g) ?? [];
  if (bootstrapCalls.length !== 1) {
    throw new ErrorsStackDetectionError(
      "Angular setup requires exactly one static bootstrapApplication call; NgModule, dynamic or multiple bootstraps are not supported and no files were modified.",
    );
  }
  const call = /\bbootstrapApplication\s*\(\s*[^,]+,\s*([A-Za-z_$][\w$]*)\s*\)/s.exec(
    entry,
  );
  const configVariable = call?.[1];
  if (!configVariable) {
    throw new ErrorsStackDetectionError(
      "Angular setup requires bootstrapApplication with one imported ApplicationConfig; no files were modified.",
    );
  }
  const imports = [
    ...entry.matchAll(
      /import\s*\{([^}]+)\}\s*from\s*["']([^"']+)["']/g,
    ),
  ];
  const configImport = imports.find(([_, names]) =>
    (names ?? "")
      .split(",")
      .map((name) => name.trim().split(/\s+as\s+/).at(-1))
      .includes(configVariable),
  );
  const modulePath = configImport?.[2];
  if (!modulePath?.startsWith(".")) {
    throw new ErrorsStackDetectionError(
      "Angular setup requires the ApplicationConfig to be imported from one local static module; no files were modified.",
    );
  }
  const path = resolve(dirname(entryPath), `${modulePath}.ts`);
  if (!existsSync(path)) {
    throw new ErrorsStackDetectionError(
      `The Angular ApplicationConfig module ${modulePath} does not exist; no files were modified.`,
    );
  }
  const config = readFileSync(path, "utf8");
  if (/\bprovideClientHydration\b/.test(config)) {
    throw new ErrorsStackDetectionError(
      "Angular SSR and hydration are not supported by the client-rendered calibration; no files were modified.",
    );
  }
  const exportedConfig = new RegExp(
    `export\\s+const\\s+${configVariable.replace(/[$]/g, "\\$")}\\s*:\\s*ApplicationConfig\\s*=\\s*\\{[\\s\\S]*?providers\\s*:\\s*\\[`,
  );
  if (!exportedConfig.test(config)) {
    throw new ErrorsStackDetectionError(
      "Angular setup requires one statically declared ApplicationConfig providers array; no files were modified.",
    );
  }
  return path;
}

function angularShape(
  cwd: string,
  pkg: PackageJson,
  deps: Record<string, string>,
): AngularProjectShape | undefined {
  const core = deps["@angular/core"];
  if (!core) return undefined;
  const angularVersion = dependencyMajor(core);
  if (angularVersion !== 20 && angularVersion !== 21 && angularVersion !== 22) {
    throw new ErrorsStackDetectionError(
      `Angular ${angularVersion ?? JSON.stringify(core)} is not supported by the private calibration; no files were modified.`,
    );
  }
  const buildVersion = dependencyMajor(deps["@angular/build"] ?? "");
  const cliVersion = dependencyMajor(deps["@angular/cli"] ?? "");
  if (buildVersion !== angularVersion || cliVersion !== angularVersion) {
    throw new ErrorsStackDetectionError(
      `Angular ${angularVersion} requires matching @angular/build and @angular/cli majors for this calibration; no files were modified.`,
    );
  }
  const angularConfigPath = join(cwd, "angular.json");
  if (!existsSync(angularConfigPath)) {
    throw new ErrorsStackDetectionError(
      "Angular was detected without angular.json at the application root; no files were modified.",
    );
  }
  let workspace: Record<string, unknown>;
  try {
    const parsed = JSON.parse(readFileSync(angularConfigPath, "utf8")) as unknown;
    const record = objectRecord(parsed);
    if (!record) throw new Error("workspace is not an object");
    workspace = record;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new ErrorsStackDetectionError(
      `Cannot read ${angularConfigPath}: ${detail}; no files were modified.`,
    );
  }
  const projects = objectRecord(workspace.projects);
  const entries = projects ? Object.entries(projects) : [];
  const applications = entries.filter(
    ([, value]) => objectRecord(value)?.projectType === "application",
  );
  if (entries.length !== 1 || applications.length !== 1) {
    throw new ErrorsStackDetectionError(
      "Angular setup requires exactly one application project in the workspace; no files were modified.",
    );
  }
  const [projectName, rawProject] = applications[0]!;
  const project = objectRecord(rawProject)!;
  if (project.root !== "" || project.sourceRoot !== "src") {
    throw new ErrorsStackDetectionError(
      "Angular setup currently requires the conventional root application with sourceRoot src; no files were modified.",
    );
  }
  const architect = objectRecord(project.architect ?? project.targets);
  const build = objectRecord(architect?.build) as AngularBuildTarget | null;
  if (!build || build.builder !== "@angular/build:application") {
    throw new ErrorsStackDetectionError(
      `The detected Angular builder ${JSON.stringify(build?.builder)} is not supported; @angular/build:application is required and no files were modified.`,
    );
  }
  const options = objectRecord(build.options) ?? {};
  const configurations = objectRecord(build.configurations) ?? {};
  const production = objectRecord(configurations.production) ?? {};
  if (
    deps["@angular/ssr"] ||
    "server" in options ||
    "ssr" in options ||
    "prerender" in options ||
    "outputMode" in options ||
    "server" in production ||
    "ssr" in production ||
    "prerender" in production ||
    "outputMode" in production
  ) {
    throw new ErrorsStackDetectionError(
      "Angular SSR, prerendering and hydration are not supported by the client-rendered calibration; no files were modified.",
    );
  }
  if ("outputPath" in options || "outputPath" in production) {
    throw new ErrorsStackDetectionError(
      "Angular custom outputPath configuration is not supported by the private-map calibration; no files were modified.",
    );
  }
  const browser = options.browser;
  if (browser !== "src/main.ts") {
    throw new ErrorsStackDetectionError(
      "Angular setup requires the conventional TypeScript browser entry src/main.ts; no files were modified.",
    );
  }
  const entryPath = join(cwd, browser);
  if (!existsSync(entryPath)) {
    throw new ErrorsStackDetectionError(
      "Angular src/main.ts is missing; no files were modified.",
    );
  }
  const appConfigPath = angularAppConfigPath(cwd, entryPath);
  const appConfig = readFileSync(appConfigPath, "utf8");
  const polyfills = Array.isArray(options.polyfills) ? options.polyfills : [];
  const hasZone =
    typeof deps["zone.js"] === "string" ||
    polyfills.some((value) => value === "zone.js") ||
    /\bprovideZoneChangeDetection\s*\(/.test(appConfig);
  const explicitZoneless = /\bprovideZonelessChangeDetection\s*\(/.test(
    appConfig,
  );
  if (angularVersion >= 21 && hasZone) {
    throw new ErrorsStackDetectionError(
      `Angular ${angularVersion} Zone.js override is not supported by the frozen zoneless calibration; no files were modified.`,
    );
  }
  if (angularVersion === 20 && !hasZone && !explicitZoneless) {
    throw new ErrorsStackDetectionError(
      "Angular 20 without Zone.js requires provideZonelessChangeDetection for this calibration; no files were modified.",
    );
  }
  const scripts = objectRecord(pkg.scripts);
  const buildScript = scripts?.build;
  if (
    buildScript !== "ng build" &&
    buildScript !== "node src/volato/angular-build.mjs"
  ) {
    throw new ErrorsStackDetectionError(
      "Angular build script must be the conventional `ng build` command; no files were modified.",
    );
  }
  return {
    cwd,
    projectName,
    entryPath,
    appConfigPath,
    angularConfigPath,
    angularVersion,
    buildAdapter: "angular",
    changeDetection: hasZone ? "zonejs" : "zoneless",
    language: "ts",
    outputRoot: join(cwd, "dist", projectName),
  };
}

function nodeShape(
  cwd: string,
  pkg: PackageJson,
  deps: Record<string, string>,
  hasBrowserBuild: boolean,
): NodeProjectShape | undefined {
  const expressInstalled = typeof deps.express === "string";
  const candidates: Array<{
    path: string;
    processShape: NodeProcessShape;
  }> = [
    ...["src/server.ts", "src/server.js", "server.ts", "server.js"].map(
      (path) => ({ path, processShape: "server" as const }),
    ),
    ...["src/job.ts", "src/job.js", "job.ts", "job.js"].map((path) => ({
      path,
      processShape: "job" as const,
    })),
    ...[
      "src/script.ts",
      "src/script.js",
      "script.ts",
      "script.js",
      "src/index.ts",
      "src/index.js",
      "index.ts",
      "index.js",
    ].map((path) => ({ path, processShape: "script" as const })),
  ].filter(({ path, processShape }) => {
    if (!existsSync(join(cwd, path))) return false;
    // A browser build commonly owns src/index.* as a helper or barrel. It is
    // not evidence of a deployed Node process without an HTTP framework.
    return !(
      hasBrowserBuild &&
      !expressInstalled &&
      processShape === "script" &&
      /^src\/index\.[jt]s$/.test(path)
    );
  });

  if (candidates.length > 1) {
    throw new ErrorsStackDetectionError(
      `Multiple conventional Node entries were detected (${candidates
        .map(({ path }) => path)
        .join(", ")}). Select one application entry explicitly; no files were modified.`,
    );
  }
  const selected = candidates[0];
  if (!selected) {
    if (expressInstalled) {
      throw new ErrorsStackDetectionError(
        "Express is installed, but Volato could not identify one conventional server entry. Use src/server.{ts,js}, server.{ts,js}, src/index.{ts,js}, or index.{ts,js}, or select the server application root explicitly.",
      );
    }
    return undefined;
  }
  const entryPath = join(cwd, selected.path);
  const express = expressInstalled
    ? detectExpressTopology(entryPath, deps.express!)
    : null;
  return {
    cwd,
    entryPath,
    express: express?.supported ?? false,
    language: languageOf(entryPath),
    module: pkg.type === "module" ? "esm" : "cjs",
    processShape: expressInstalled ? "server" : selected.processShape,
    ...(express?.supported
      ? {
          expressVersion: express.version,
          expressTopology: express.topology,
          expressAppPath: express.appPath,
        }
      : express
        ? { expressUnsupportedReason: express.reason }
        : {}),
  };
}

function fastifyCreation(source: string): string | null {
  return (
    /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:Fastify|fastify)(?:\.default)?\s*\(/.exec(
      source,
    )?.[1] ??
    /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*require\s*\(\s*["']fastify["']\s*\)\s*\(/.exec(
      source,
    )?.[1] ??
    null
  );
}

function fastifyShape(
  cwd: string,
  pkg: PackageJson,
  deps: Record<string, string>,
): FastifyProjectShape | undefined {
  const version = deps.fastify;
  if (!version) return undefined;
  const major = dependencyMajor(version);
  if (major !== 5) {
    throw new ErrorsStackDetectionError(
      `Fastify ${major ?? JSON.stringify(version)} HTTP capture is not supported; Fastify 5 is required and no files were modified.`,
    );
  }
  const candidates = [
    "src/server.ts",
    "src/server.js",
    "server.ts",
    "server.js",
    "src/index.ts",
    "src/index.js",
    "index.ts",
    "index.js",
  ].filter((path) => existsSync(join(cwd, path)));
  if (candidates.length !== 1) {
    throw new ErrorsStackDetectionError(
      candidates.length === 0
        ? "Fastify 5 is installed, but one conventional server entry could not be identified; no files were modified."
        : `Multiple conventional Fastify entries were detected (${candidates.join(", ")}); select one application root explicitly and no files were modified.`,
    );
  }
  const entryPath = join(cwd, candidates[0]!);
  const entry = readFileSync(entryPath, "utf8");
  const entryVariable = fastifyCreation(entry);
  const entryListens = entry.match(/\b[A-Za-z_$][\w$]*\.listen\s*\(/g) ?? [];
  const extension = languageOf(entryPath) === "ts" ? "ts" : "js";
  const appPath = join(dirname(entryPath), `app.${extension}`);

  if (entryVariable && entryListens.length === 1 && !existsSync(appPath)) {
    return {
      cwd,
      entryPath,
      appPath: entryPath,
      appVariable: entryVariable,
      topology: "same-file",
      fastifyVersion: 5,
      express: false,
      language: languageOf(entryPath),
      module: pkg.type === "module" ? "esm" : "cjs",
      processShape: "server",
    };
  }

  if (existsSync(appPath) && entryListens.length === 1) {
    const app = readFileSync(appPath, "utf8");
    const appVariable = fastifyCreation(app);
    const importsApp =
      /(?:from\s*["']\.\/app(?:\.[cm]?[jt]s)?["']|require\s*\(\s*["']\.\/app(?:\.[cm]?[jt]s)?["']\s*\))/.test(
        entry,
      );
    const exportsApp =
      /\bmodule\.exports\s*=/.test(app) ||
      /\bexport\s+default\b/.test(app) ||
      /\bexport\s*\{/.test(app);
    if (appVariable && importsApp && exportsApp) {
      return {
        cwd,
        entryPath,
        appPath,
        appVariable,
        topology: "split-bootstrap",
        fastifyVersion: 5,
        express: false,
        language: languageOf(entryPath),
        module: pkg.type === "module" ? "esm" : "cjs",
        processShape: "server",
      };
    }
  }

  throw new ErrorsStackDetectionError(
    "Fastify 5 was detected, but one supported same-file or split app/listen topology could not be identified; no files were modified.",
  );
}

function sourceFiles(root: string): string[] {
  if (!existsSync(root) || !statSync(root).isDirectory()) return [];
  return readdirSync(root).flatMap((name) => {
    const path = join(root, name);
    if (statSync(path).isDirectory()) {
      return name === "volato-node" ? [] : sourceFiles(path);
    }
    return /\.[cm]?[jt]sx?$/.test(name) ? [path] : [];
  });
}

function nestShape(
  cwd: string,
  pkg: PackageJson,
  deps: Record<string, string>,
): NestProjectShape | undefined {
  const core = deps["@nestjs/core"];
  if (!core) return undefined;
  const nestMajor = dependencyMajor(core);
  if (nestMajor !== 11 && nestMajor !== 12) {
    throw new ErrorsStackDetectionError(
      `NestJS ${nestMajor ?? JSON.stringify(core)} HTTP capture is not supported; NestJS 11 or 12 is required and no files were modified.`,
    );
  }
  if (dependencyMajor(deps["@nestjs/common"] ?? "") !== nestMajor) {
    throw new ErrorsStackDetectionError(
      "NestJS core and common majors must match before HTTP capture can be installed; no files were modified.",
    );
  }
  for (const [dependency, label] of [
    ["@nestjs/graphql", "GraphQL"],
    ["@nestjs/websockets", "WebSocket"],
    ["@nestjs/microservices", "microservice"],
  ] as const) {
    if (typeof deps[dependency] === "string") {
      throw new ErrorsStackDetectionError(
        `NestJS ${label} capture is not supported by the HTTP recipe; no files were modified.`,
      );
    }
  }
  if (
    typeof deps.serverless === "string" ||
    existsSync(join(cwd, "serverless.yml")) ||
    existsSync(join(cwd, "serverless.yaml"))
  ) {
    throw new ErrorsStackDetectionError(
      "Serverless NestJS lifecycle capture is not supported by the long-lived HTTP recipe; no files were modified.",
    );
  }
  const entryPath = join(cwd, "src", "main.ts");
  if (!existsSync(entryPath)) {
    throw new ErrorsStackDetectionError(
      "NestJS HTTP setup requires the conventional src/main.ts bootstrap; no files were modified.",
    );
  }
  if (pkg.type === "module") {
    throw new ErrorsStackDetectionError(
      "NestJS ESM bootstrap is outside the currently conformed CommonJS HTTP recipe; no files were modified.",
    );
  }
  const source = readFileSync(entryPath, "utf8");
  if (/\bconnectMicroservice\s*\(|\bcreateMicroservice\s*</.test(source)) {
    throw new ErrorsStackDetectionError(
      "Hybrid or microservice NestJS bootstrap is not supported by the HTTP recipe; no files were modified.",
    );
  }
  const creations = [
    ...source.matchAll(
      /\b(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*await\s+NestFactory\.create(?:<[^;]+?>)?\s*\(([\s\S]*?)\)\s*;/g,
    ),
  ];
  if (creations.length !== 1) {
    throw new ErrorsStackDetectionError(
      "NestJS HTTP setup requires exactly one NestFactory.create application; no files were modified.",
    );
  }
  const appVariable = creations[0]![1]!;
  const argumentsSource = creations[0]![2]!;
  const transport: NestHttpTransport = /\bnew\s+FastifyAdapter\s*\(/.test(
    argumentsSource,
  )
    ? "fastify"
    : argumentsSource.includes(",")
      ? (() => {
          throw new ErrorsStackDetectionError(
            "A custom HTTP adapter was detected in NestFactory.create; no files were modified.",
          );
        })()
      : "express";
  if (transport === "fastify") {
    if (
      dependencyMajor(deps["@nestjs/platform-fastify"] ?? "") !== nestMajor ||
      dependencyMajor(deps.fastify ?? "") !== 5
    ) {
      throw new ErrorsStackDetectionError(
        "NestJS Fastify HTTP capture requires the matching platform adapter and Fastify 5; no files were modified.",
      );
    }
  } else if (
    deps["@nestjs/platform-express"] &&
    dependencyMajor(deps["@nestjs/platform-express"]!) !== nestMajor
  ) {
    throw new ErrorsStackDetectionError(
      "NestJS Express platform and core majors must match; no files were modified.",
    );
  }
  const globalFilters = source.match(/\buseGlobalFilters\s*\(/g) ?? [];
  if (
    globalFilters.length > 0 &&
    !(
      globalFilters.length === 1 &&
      source.includes("new VolatoHttpExceptionFilter(httpAdapter)")
    )
  ) {
    throw new ErrorsStackDetectionError(
      "An existing NestJS exception filter requires explicit catch-all delegation; no files were modified.",
    );
  }
  for (const path of sourceFiles(join(cwd, "src"))) {
    const candidate = readFileSync(path, "utf8");
    if (/\bAPP_FILTER\b|@UseFilters\s*\(|@Catch\s*\(\s*\)/.test(candidate)) {
      throw new ErrorsStackDetectionError(
        `An existing NestJS exception filter at ${relative(cwd, path)} requires explicit delegation; no files were modified.`,
      );
    }
  }
  const listen = new RegExp(
    `\\b${appVariable.replace(/[$]/g, "\\$")}\\.listen\\s*\\(`,
  );
  if (!listen.test(source)) {
    throw new ErrorsStackDetectionError(
      "The NestJS application does not have one conventional app.listen lifecycle; no files were modified.",
    );
  }
  return {
    cwd,
    entryPath,
    appVariable,
    nestVersion: nestMajor,
    transport,
    transportVersion: 5,
    express: false,
    language: "ts",
    module: "cjs",
    processShape: "server",
  };
}

function handlerParameters(source: string): string[] | null {
  const arrow =
    /(?:export\s+const\s+handler(?:\s*:[^=\n]+)?\s*=|(?:module\.)?exports\.handler\s*=)\s*(async\s+)?(?:\(([^)]*)\)|([A-Za-z_$][\w$]*))\s*=>/m.exec(
      source,
    );
  if (arrow) {
    return (arrow[2] ?? arrow[3] ?? "")
      .split(",")
      .map((parameter) => parameter.trim())
      .filter(Boolean);
  }
  const declaration =
    /export\s+(async\s+)?function\s+handler\s*\(([^)]*)\)/m.exec(source);
  if (!declaration) return null;
  return declaration[2]!
    .split(",")
    .map((parameter) => parameter.trim())
    .filter(Boolean);
}

function generatedHandlerParameters(source: string): string[] | null {
  const arrow =
    /const\s+volatoOriginalHandler(?:\s*:[^=\n]+)?\s*=\s*async\s*(?:function\s*)?(?:\(([^)]*)\)|([A-Za-z_$][\w$]*))\s*(?:=>|\{)/m.exec(
      source,
    );
  if (arrow) {
    return (arrow[1] ?? arrow[2] ?? "")
      .split(",")
      .map((parameter) => parameter.trim())
      .filter(Boolean);
  }
  const declaration =
    /async\s+function\s+volatoOriginalHandler\s*\(([^)]*)\)/m.exec(source);
  return declaration
    ? declaration[1]!
        .split(",")
        .map((parameter) => parameter.trim())
        .filter(Boolean)
    : null;
}

function parameterName(parameter: string): string {
  return parameter
    .replace(/^\.\.\./, "")
    .split(/[?:=]/, 1)[0]!
    .trim()
    .replace(/^\{.*$/, "")
    .replace(/^\[.*$/, "");
}

function nodeInvocationShape(
  cwd: string,
  pkg: PackageJson,
): NodeInvocationProjectShape | undefined {
  const candidates = [
    "src/handler.ts",
    "src/handler.js",
    "handler.ts",
    "handler.js",
  ].filter((path) => existsSync(join(cwd, path)));
  if (candidates.length > 1) {
    throw new ErrorsStackDetectionError(
      `Multiple conventional Node invocation entries were detected (${candidates.join(", ")}). Select one handler entry explicitly; no files were modified.`,
    );
  }
  const selected = candidates[0];
  if (!selected) return undefined;

  const handlerPath = join(cwd, selected);
  const source = readFileSync(handlerPath, "utf8");
  if (
    /\b(?:ReadableStream|ServerResponse\.prototype\.write)\b/.test(source) ||
    /\b(?:res|response)\.write\s*\(/.test(source) ||
    /\.pipe(?:To)?\s*\(/.test(source)
  ) {
    throw new ErrorsStackDetectionError(
      `Streaming response completion is outside the promise contract at ${selected}; no files were modified.`,
    );
  }
  const generated =
    source.includes("withVolatoInvocation") &&
    /(?:export\s+const|(?:module\.)?exports\.)\s*handler\s*=\s*withVolatoInvocation\s*\(\s*volatoOriginalHandler\b/m.test(
      source,
    );
  const parameters = generated
    ? generatedHandlerParameters(source)
    : handlerParameters(source);
  if (!parameters) {
    throw new ErrorsStackDetectionError(
      `A conventional Node invocation entry was detected at ${selected}, but one exported handler could not be identified. No files were modified.`,
    );
  }
  const parameterNames = parameters.map(parameterName);
  if (
    parameterNames.some((name) => /^(?:callback|cb|done)$/i.test(name)) ||
    parameters.length >= 3
  ) {
    throw new ErrorsStackDetectionError(
      `Callback-style invocation completion is outside the promise contract at ${selected}; no files were modified.`,
    );
  }
  const asynchronous =
    generated ||
    /(?:export\s+const\s+handler(?:\s*:[^=\n]+)?\s*=|(?:module\.)?exports\.handler\s*=)\s*async\b/m.test(
      source,
    ) ||
    /export\s+async\s+function\s+handler\s*\(/m.test(source);
  if (!asynchronous) {
    throw new ErrorsStackDetectionError(
      `A synchronous invocation handler was detected at ${selected}; only a promise-returning asynchronous handler can be wrapped automatically, and no files were modified.`,
    );
  }

  const first = parameterNames[0] ?? "";
  const second = parameterNames[1] ?? "";
  const handlerShape = generated
    ? /withVolatoInvocation\s*\([^)]*\bhttp\s*:\s*true/m.test(source)
      ? "node-http-handler"
      : "async-handler"
    : /^(?:_?req(?:uest)?)$/i.test(first) &&
        /^(?:_?res(?:ponse)?)$/i.test(second)
      ? "node-http-handler"
      : "async-handler";
  return {
    cwd,
    handlerPath,
    handlerShape,
    language: languageOf(handlerPath),
    module: pkg.type === "module" ? "esm" : "cjs",
  };
}

type ExpressDetection =
  | {
      supported: true;
      version: 4 | 5;
      topology: ExpressTopology;
      appPath: string;
    }
  | { supported: false; reason: string };

function dependencyMajor(specifier: string): number | null {
  const match = /(?:^|[^0-9])(\d+)(?:\.|$)/.exec(specifier);
  return match ? Number(match[1]) : null;
}

function detectExpressTopology(
  entryPath: string,
  versionSpecifier: string,
): ExpressDetection {
  const major = dependencyMajor(versionSpecifier);
  if (major !== 4 && major !== 5) {
    return {
      supported: false,
      reason: `Express ${major ?? JSON.stringify(versionSpecifier)} HTTP composition is not supported`,
    };
  }
  const entry = readFileSync(entryPath, "utf8");
  const createsApp =
    /\b(?:const|let|var)\s+app\s*=\s*express(?:\.default)?\s*\(/.test(
      entry,
    );
  const listens = /\bapp\.listen\s*\(/.test(entry);
  const extension = languageOf(entryPath) === "ts" ? "ts" : "js";
  const appPath = join(dirname(entryPath), `app.${extension}`);
  const hasAppFile = existsSync(appPath) && appPath !== entryPath;

  if (createsApp && listens && !hasAppFile) {
    return {
      supported: true,
      version: major,
      topology: "same-file",
      appPath: entryPath,
    };
  }
  if (hasAppFile && listens) {
    const app = readFileSync(appPath, "utf8");
    const importsApp =
      /(?:from\s*["']\.\/app(?:\.[cm]?[jt]s)?["']|require\s*\(\s*["']\.\/app(?:\.[cm]?[jt]s)?["']\s*\))/.test(
        entry,
      );
    const appCreatesExpress =
      /\b(?:const|let|var)\s+app\s*=\s*express(?:\.default)?\s*\(/.test(
        app,
      );
    if (importsApp && appCreatesExpress) {
      return {
        supported: true,
        version: major,
        topology: "split-bootstrap",
        appPath,
      };
    }
  }
  return {
    supported: false,
    reason:
      "Express was detected, but one supported same-file or split app/listen topology could not be identified",
  };
}

function nestedPackageRoots(cwd: string, pkg: PackageJson): string[] {
  if (!pkg.workspaces) return [];
  const roots: string[] = [];
  for (const parent of ["apps", "packages"]) {
    const directory = join(cwd, parent);
    if (!existsSync(directory) || !statSync(directory).isDirectory()) continue;
    for (const name of readdirSync(directory)) {
      const candidate = join(directory, name);
      if (
        statSync(candidate).isDirectory() &&
        existsSync(join(candidate, "package.json"))
      ) {
        roots.push(candidate);
      }
    }
  }
  return roots;
}

function looksSupported(root: string): boolean {
  try {
    const deps = dependencies(readPackageJson(root));
    return Boolean(
      deps.next ||
        deps.nuxt ||
        deps["@angular/core"] ||
        deps.express ||
        deps.fastify ||
        deps["@nestjs/core"] ||
        ["src/handler.ts", "src/handler.js", "handler.ts", "handler.js"].some(
          (path) => existsSync(join(root, path)),
        ) ||
        (deps.react &&
          (deps.vite || deps.webpack || deps["@rspack/core"] || deps["@rspack/cli"])),
    );
  } catch {
    return false;
  }
}

export function detectErrorsStack(cwd: string): ErrorsStackShape {
  if (!existsSync(join(cwd, "package.json"))) {
    const hasPythonManifest = ["pyproject.toml", "requirements.txt", "Pipfile"].some(
      (path) => existsSync(join(cwd, path)),
    );
    if (hasPythonManifest) {
      return { cwd, fastapi: fastApiShape(cwd), notices: [] };
    }
  }
  const pkg = readPackageJson(cwd);
  const deps = dependencies(pkg);

  const nested = nestedPackageRoots(cwd, pkg).filter(looksSupported);
  if (
    nested.length > 0 &&
    !deps.next &&
    !deps.nuxt &&
    !deps.vite &&
    !deps.express
  ) {
    throw new ErrorsStackDetectionError(
      `This monorepo contains multiple supported applications or requires an explicit target (${nested.join(", ")}). Run Volato from the selected application root; no application was modified.`,
    );
  }

  if (deps.next) {
    return { cwd, nextjs: detectProject(cwd), notices: [] };
  }

  if (deps.nuxt) {
    return { cwd, nuxt: nuxtShape(cwd, pkg, deps), notices: [] };
  }

  const angular = angularShape(cwd, pkg, deps);

  const { browserReact, browserVue, browserSvelte } = browserShapes(cwd, deps);
  const viteReact =
    browserReact?.buildAdapter === "vite"
      ? {
          ...browserReact,
          buildAdapter: "vite" as const,
          viteConfigPath: browserReact.buildConfigPath,
        }
      : undefined;
  const nest = nestShape(cwd, pkg, deps);
  const fastify = nest ? undefined : fastifyShape(cwd, pkg, deps);
  const node = fastify || nest
    ? undefined
    : nodeShape(
        cwd,
        pkg,
        deps,
        Boolean(browserReact || browserVue || browserSvelte || angular),
      );
  const nodeInvocation = nodeInvocationShape(cwd, pkg);
  const unsupportedBackends = unsupportedBackendLabels(cwd);
  const unsupportedHttpFrameworks = UNSUPPORTED_HTTP_FRAMEWORKS.filter(
    ([dependency]) => typeof deps[dependency] === "string",
  );
  if (
    !angular &&
    !browserReact &&
    !browserVue &&
    !browserSvelte &&
    !fastify &&
    !nest &&
    !node &&
    !nodeInvocation
  ) {
    const unsupported = [
      ...unsupportedBackends.map((label) => `${label} backend`),
      ...unsupportedHttpFrameworks.map(([, label]) => `${label} HTTP`),
    ];
    if (unsupported.length > 0) {
      throw new ErrorsStackDetectionError(
        `${unsupported.join(" and ")} capture is not supported in this release, and no supported application target was found. No files were modified.`,
      );
    }
    throw new ErrorsStackDetectionError(
      "No supported Errors stack was detected. Supported targets are Next.js 15/16, React in the browser with Vite, Webpack, or Rspack, long-lived Node.js (with Express as the supported HTTP adapter), and provider-neutral asynchronous Node invocation handlers.",
    );
  }

  const notices: string[] = [];
  for (const label of unsupportedBackends) {
    notices.push(
      node
        ? `${label} backend capture is not supported; that backend was not modified.`
        : `${label} backend capture is not supported; only React browser capture will be installed.`,
    );
  }
  for (const [, label] of unsupportedHttpFrameworks) {
    notices.push(
      node
        ? `${label} HTTP context is not supported; only generic Node process and manual capture will be installed.`
        : `${label} HTTP context is not supported and no conventional Node server entry was found; the server was not modified.`,
    );
  }
  if (node?.expressUnsupportedReason) {
    notices.push(
      `${node.expressUnsupportedReason}; generic Node process capture will be installed without Express HTTP context.`,
    );
  }
  return {
    cwd,
    angular,
    browserReact,
    viteReact,
    browserVue,
    browserSvelte,
    fastify,
    nest,
    node,
    nodeInvocation,
    notices,
  };
}
