import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { detectProject, type ProjectShape } from "./detect.js";

export type SourceLanguage = "ts" | "js";

export type ViteReactProjectShape = {
  cwd: string;
  entryPath: string;
  viteConfigPath: string;
  language: SourceLanguage;
};

export type NodeProjectShape = {
  cwd: string;
  entryPath: string;
  express: boolean;
  language: SourceLanguage;
};

export type ErrorsStackShape = {
  cwd: string;
  nextjs?: ProjectShape;
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

function viteShape(cwd: string): ViteReactProjectShape | undefined {
  const viteConfigPath = firstExisting(cwd, [
    "vite.config.ts",
    "vite.config.mts",
    "vite.config.js",
    "vite.config.mjs",
  ]);
  const entryPath = firstExisting(cwd, [
    "src/main.tsx",
    "src/main.jsx",
    "src/main.ts",
    "src/main.js",
  ]);
  if (!viteConfigPath || !entryPath) {
    throw new ErrorsStackDetectionError(
      "Vite + React was detected, but Volato could not find both vite.config.* and src/main.{tsx,jsx,ts,js}.",
    );
  }
  return { cwd, entryPath, viteConfigPath, language: languageOf(entryPath) };
}

function nodeShape(
  cwd: string,
  deps: Record<string, string>,
  hasVite: boolean,
): NodeProjectShape | undefined {
  const entryPath = firstExisting(cwd, [
    "src/server.ts",
    "src/server.js",
    "server.ts",
    "server.js",
    "src/index.ts",
    "src/index.js",
    "index.ts",
    "index.js",
  ]);
  const express = typeof deps.express === "string";
  if (!entryPath) {
    if (express) {
      throw new ErrorsStackDetectionError(
        "Express is installed, but Volato could not identify a server entry. Use src/server.ts, src/server.js, server.ts, or server.js, or select the server application root explicitly.",
      );
    }
    return undefined;
  }

  // Vite's own Node-based build toolchain is not evidence of a deployed Node
  // runtime. A Vite app gets server capture only when a distinct server entry
  // exists (or Express is explicitly installed).
  if (hasVite && !express && /src\/index\.[jt]s$/.test(entryPath)) {
    return undefined;
  }
  return { cwd, entryPath, express, language: languageOf(entryPath) };
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
    return Boolean(deps.next || deps.vite || deps.express);
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

  const hasVite = typeof deps.vite === "string";
  const hasReact = typeof deps.react === "string";
  if (hasVite && !hasReact) {
    throw new ErrorsStackDetectionError(
      "Vite is supported only with React in this release. Vue, Svelte, and other Vite frameworks were not modified.",
    );
  }

  const viteReact = hasVite && hasReact ? viteShape(cwd) : undefined;
  const node = nodeShape(cwd, deps, hasVite);
  const unsupportedBackends = unsupportedBackendLabels(cwd);
  const unsupportedHttpFrameworks = UNSUPPORTED_HTTP_FRAMEWORKS.filter(
    ([dependency]) => typeof deps[dependency] === "string",
  );
  if (!viteReact && !node) {
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
      "No supported Errors stack was detected. Supported targets are Next.js 15/16 App Router, Vite + React in the browser, and Node.js (with Express as the supported HTTP adapter).",
    );
  }

  const notices: string[] = [];
  for (const label of unsupportedBackends) {
    notices.push(
      node
        ? `${label} backend capture is not supported; that backend was not modified.`
        : `${label} backend capture is not supported; only Vite + React browser capture will be installed.`,
    );
  }
  for (const [, label] of unsupportedHttpFrameworks) {
    notices.push(
      node
        ? `${label} HTTP context is not supported; only generic Node process and manual capture will be installed.`
        : `${label} HTTP context is not supported and no conventional Node server entry was found; the server was not modified.`,
    );
  }
  return { cwd, viteReact, node, notices };
}
