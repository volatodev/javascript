import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { detectProject, type ProjectShape } from "./detect.js";

export type SourceLanguage = "ts" | "js";
export type BrowserBuildAdapter = "vite" | "webpack" | "rspack";
export type NodeModuleFormat = "esm" | "cjs";
export type NodeProcessShape = "server" | "job" | "script";
export type ExpressTopology = "same-file" | "split-bootstrap";

export type BrowserReactProjectShape = {
  cwd: string;
  entryPath: string;
  buildConfigPath: string;
  buildAdapter: BrowserBuildAdapter;
  language: SourceLanguage;
};

export type ViteReactProjectShape = BrowserReactProjectShape & {
  buildAdapter: "vite";
  viteConfigPath: string;
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

export type ErrorsStackShape = {
  cwd: string;
  nextjs?: ProjectShape;
  browserReact?: BrowserReactProjectShape;
  viteReact?: ViteReactProjectShape;
  node?: NodeProjectShape;
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
  ["fastify", "Fastify"],
  ["hono", "Hono"],
  ["@nestjs/core", "NestJS"],
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

function browserShape(
  cwd: string,
  deps: Record<string, string>,
): BrowserReactProjectShape | undefined {
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
      `${candidate.label} + React was detected, but Volato could not find a supported ${candidate.configs.join(" or ")}. No files were modified.`,
    );
  }
  if (typeof deps.react !== "string") {
    throw new ErrorsStackDetectionError(
      `${selected.label} is supported only with React in this release. Other renderers were not modified.`,
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
      `${selected.label} + React was detected, but Volato could not find src/main.{tsx,jsx,ts,js}. No files were modified.`,
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
        deps.express ||
        (deps.react &&
          (deps.vite || deps.webpack || deps["@rspack/core"] || deps["@rspack/cli"])),
    );
  } catch {
    return false;
  }
}

export function detectErrorsStack(cwd: string): ErrorsStackShape {
  const pkg = readPackageJson(cwd);
  const deps = dependencies(pkg);

  const nested = nestedPackageRoots(cwd, pkg).filter(looksSupported);
  if (nested.length > 0 && !deps.next && !deps.vite && !deps.express) {
    throw new ErrorsStackDetectionError(
      `This monorepo contains multiple supported applications or requires an explicit target (${nested.join(", ")}). Run Volato from the selected application root; no application was modified.`,
    );
  }

  if (deps.next) {
    return { cwd, nextjs: detectProject(cwd), notices: [] };
  }

  const browserReact = browserShape(cwd, deps);
  const viteReact =
    browserReact?.buildAdapter === "vite"
      ? {
          ...browserReact,
          buildAdapter: "vite" as const,
          viteConfigPath: browserReact.buildConfigPath,
        }
      : undefined;
  const node = nodeShape(cwd, pkg, deps, Boolean(browserReact));
  const unsupportedBackends = unsupportedBackendLabels(cwd);
  const unsupportedHttpFrameworks = UNSUPPORTED_HTTP_FRAMEWORKS.filter(
    ([dependency]) => typeof deps[dependency] === "string",
  );
  if (!browserReact && !node) {
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
      "No supported Errors stack was detected. Supported targets are Next.js 15/16, React in the browser with Vite, Webpack, or Rspack, and Node.js (with Express as the supported HTTP adapter).",
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
  return { cwd, browserReact, viteReact, node, notices };
}
