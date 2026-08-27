import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
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
  browserReact?: BrowserReactProjectShape;
  viteReact?: ViteReactProjectShape;
  browserVue?: ViteVueProjectShape;
  browserSvelte?: ViteSvelteProjectShape;
  node?: NodeProjectShape;
  fastify?: FastifyProjectShape;
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
    if (/<svelte:(?:head|window|body|document|options)\b/.test(rootSource)) {
      throw new ErrorsStackDetectionError(
        "A root-level Svelte special element requires explicit boundary placement; no files were modified.",
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
        deps.express ||
        deps.fastify ||
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

  const { browserReact, browserVue, browserSvelte } = browserShapes(cwd, deps);
  const viteReact =
    browserReact?.buildAdapter === "vite"
      ? {
          ...browserReact,
          buildAdapter: "vite" as const,
          viteConfigPath: browserReact.buildConfigPath,
        }
      : undefined;
  const fastify = fastifyShape(cwd, pkg, deps);
  const node = fastify
    ? undefined
    : nodeShape(
        cwd,
        pkg,
        deps,
        Boolean(browserReact || browserVue || browserSvelte),
      );
  const nodeInvocation = nodeInvocationShape(cwd, pkg);
  const unsupportedBackends = unsupportedBackendLabels(cwd);
  const unsupportedHttpFrameworks = UNSUPPORTED_HTTP_FRAMEWORKS.filter(
    ([dependency]) => typeof deps[dependency] === "string",
  );
  if (
    !browserReact &&
    !browserVue &&
    !browserSvelte &&
    !fastify &&
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
    browserReact,
    viteReact,
    browserVue,
    browserSvelte,
    fastify,
    node,
    nodeInvocation,
    notices,
  };
}
