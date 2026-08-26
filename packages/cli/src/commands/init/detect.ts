/**
 * Project detection for `volato init`. Walks a customer's
 * Next.js project tree and figures out where the layout lives
 * (`app/` vs `src/app/`), whether they're on TypeScript or
 * JavaScript, where their `next.config.{ts,js,mjs}` is, and
 * whether they already have an `instrumentation.ts` / `middleware.ts`.
 *
 * Lives separately from `init.ts` and `patch.ts` so each rule is
 * a pure function with no I/O wrapper — the test suite hands it
 * a fixture tree on disk and asserts the resulting `ProjectShape`
 * without booting commander or prompting for a DSN.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

export type AppRouterLocation = "app" | "src/app";
export type PagesRouterLocation = "pages" | "src/pages";
export type NextjsRouterKind = "app" | "pages" | "hybrid";

export type ProjectShape = {
  cwd: string;
  routerKind: NextjsRouterKind;
  appDir: AppRouterLocation | null;
  layoutPath: string | null;
  pagesDir: PagesRouterLocation | null;
  pagesAppPath: string | null;
  pagesErrorPath: string | null;
  instrumentationPath: string;
  middlewarePath: string | null;
  /** Next.js 16 Node-runtime request boundary (`proxy.ts` / `.js`). */
  proxyPath: string | null;
  /** Absolute path to the existing next.config.{ts,mjs,js}, or null. */
  nextConfigPath: string | null;
  /** Absolute path where the App Router render error boundary should live. */
  errorBoundaryPath: string | null;
  /** Confirmed major version from the package.json dependency specifier. */
  nextMajor: number;
  language: "ts" | "js";
};

export class DetectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DetectionError";
  }
}

function readJsonSafe(path: string): Record<string, unknown> | null {
  if (!existsSync(path)) return null;
  try {
    const raw = readFileSync(path, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object") {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

function nextVersionSpecifier(pkg: Record<string, unknown>): string | null {
  for (const field of ["dependencies", "devDependencies"] as const) {
    const deps = pkg[field];
    if (!deps || typeof deps !== "object") continue;
    const value = (deps as Record<string, unknown>).next;
    if (typeof value === "string") return value.trim();
  }
  return null;
}

function supportedNextMajor(specifier: string): number | null {
  // Common npm semver forms: 15.5.0, ^15.5.0, ~15, >=15.0.0 <16.
  // Tags, git URLs, aliases and workspace references cannot prove the runtime
  // contract, so setup fails with an actionable message instead of guessing.
  const match = /(?:^|[<>=~^|\s])v?(\d+)(?:\.|$)/.exec(specifier);
  if (!match) return null;
  const major = Number(match[1]);
  return Number.isInteger(major) ? major : null;
}

function findLayout(
  cwd: string,
  appDir: AppRouterLocation,
): { path: string; ext: "tsx" | "jsx" } | null {
  for (const ext of ["tsx", "jsx"] as const) {
    const candidate = join(cwd, appDir, `layout.${ext}`);
    if (existsSync(candidate)) return { path: candidate, ext };
  }
  return null;
}

const PAGE_EXTENSIONS = ["tsx", "ts", "jsx", "js"] as const;

function filesUnder(root: string): string[] {
  if (!existsSync(root) || !statSync(root).isDirectory()) return [];
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name);
    return entry.isDirectory() ? filesUnder(path) : [path];
  });
}

function findPagesDirectory(cwd: string): PagesRouterLocation | null {
  // Match Next.js's own `findDir`: a root router takes precedence over its
  // `src/` counterpart. App and Pages precedence are independent; Next.js 15
  // still accepts mixed hybrids while Next.js 16 rejects them below.
  for (const location of ["pages", "src/pages"] as const) {
    const root = join(cwd, location);
    if (
      filesUnder(root).some(
        (path) =>
          PAGE_EXTENSIONS.some((extension) => path.endsWith(`.${extension}`)) &&
          !path.endsWith(".d.ts"),
      )
    ) {
      return location;
    }
  }
  return null;
}

function findReservedPage(
  cwd: string,
  pagesDir: PagesRouterLocation,
  name: "_app" | "_error",
): string | null {
  return (
    PAGE_EXTENSIONS.map((extension) =>
      join(cwd, pagesDir, `${name}.${extension}`),
    ).find(existsSync) ?? null
  );
}

function languageFromPath(path: string): "ts" | "js" {
  return /\.tsx?$/.test(path) ? "ts" : "js";
}

function pagesLanguage(
  cwd: string,
  pagesDir: PagesRouterLocation,
  pagesAppPath: string | null,
): "ts" | "js" {
  if (pagesAppPath) return languageFromPath(pagesAppPath);
  if (existsSync(join(cwd, "tsconfig.json"))) return "ts";
  return filesUnder(join(cwd, pagesDir)).some((path) => /\.tsx?$/.test(path))
    ? "ts"
    : "js";
}

/**
 * Infer the project shape from the directory tree alone. Throws a
 * `DetectionError` with a user-actionable message when the project is missing
 * the required pieces.
 */
export function detectProject(cwd: string): ProjectShape {
  const pkgPath = join(cwd, "package.json");
  const pkg = readJsonSafe(pkgPath);
  if (!pkg) {
    throw new DetectionError(
      `No package.json found in ${cwd}. Run this command from your Next.js project root.`,
    );
  }
  const nextSpecifier = nextVersionSpecifier(pkg);
  if (!nextSpecifier) {
    throw new DetectionError(
      "Next.js is not listed in dependencies or devDependencies. Run `pnpm add next` first.",
    );
  }
  const nextMajor = supportedNextMajor(nextSpecifier);
  if (nextMajor === null) {
    throw new DetectionError(
      `Cannot confirm the Next.js version from package.json specifier "${nextSpecifier}". Pin a semver range for Next.js 15 or newer before running Volato setup.`,
    );
  }
  if (nextMajor < 15) {
    throw new DetectionError(
      `Volato requires Next.js 15 or newer; package.json declares "${nextSpecifier}".`,
    );
  }

  const appDir =
    (["app", "src/app"] as const).find((location) =>
      findLayout(cwd, location),
    ) ?? null;
  const layout = appDir ? findLayout(cwd, appDir) : null;
  const pagesDir = findPagesDirectory(cwd);
  if (!layout && !pagesDir) {
    throw new DetectionError(
      "No App Router app/layout.{tsx,jsx} or Pages Router pages/* entry was found.",
    );
  }
  if (
    nextMajor >= 16 &&
    appDir &&
    pagesDir &&
    appDir.startsWith("src/") !== pagesDir.startsWith("src/")
  ) {
    throw new DetectionError(
      "Next.js 16 requires `app` and `pages` under the same root (`./` or `src/`). Move one router before running Volato; no files were modified.",
    );
  }

  const existingPagesAppPath = pagesDir
    ? findReservedPage(cwd, pagesDir, "_app")
    : null;
  const language: "ts" | "js" = layout
    ? layout.ext === "tsx"
      ? "ts"
      : "js"
    : pagesLanguage(cwd, pagesDir!, existingPagesAppPath);
  // Next.js discovers instrumentation and middleware beside Pages Router when
  // it exists, otherwise beside App Router (`pagesDir || appDir` internally).
  const frameworkRoot = pagesDir ?? appDir!;
  const sourceRoot = frameworkRoot.startsWith("src/");
  const instrumentationDir = sourceRoot ? join(cwd, "src") : cwd;
  const instrumentationPath = join(
    instrumentationDir,
    `instrumentation.${language}`,
  );
  const pagesComponentExtension = language === "ts" ? "tsx" : "jsx";
  const pagesAppPath = pagesDir
    ? existingPagesAppPath ??
      join(cwd, pagesDir, `_app.${pagesComponentExtension}`)
    : null;
  const pagesErrorPath = pagesDir
    ? findReservedPage(cwd, pagesDir, "_error") ??
      join(cwd, pagesDir, `_error.${pagesComponentExtension}`)
    : null;

  const middlewareCandidates = [
    join(instrumentationDir, "middleware.ts"),
    join(instrumentationDir, "middleware.js"),
  ];
  const middlewarePath =
    middlewareCandidates.find((p) => existsSync(p)) ?? null;

  const proxyCandidates = [
    join(instrumentationDir, "proxy.ts"),
    join(instrumentationDir, "proxy.js"),
  ];
  const proxyPath =
    nextMajor >= 16 ? proxyCandidates.find((p) => existsSync(p)) ?? null : null;

  const nextConfigCandidates = [
    join(cwd, "next.config.ts"),
    join(cwd, "next.config.mjs"),
    join(cwd, "next.config.js"),
  ];
  const nextConfigPath =
    nextConfigCandidates.find((p) => existsSync(p)) ?? null;

  const errorBoundaryPath =
    appDir && layout ? join(cwd, appDir, `error.${layout.ext}`) : null;
  const routerKind: NextjsRouterKind =
    appDir && pagesDir ? "hybrid" : appDir ? "app" : "pages";

  return {
    cwd,
    routerKind,
    appDir,
    layoutPath: layout?.path ?? null,
    pagesDir,
    pagesAppPath,
    pagesErrorPath,
    instrumentationPath,
    middlewarePath,
    proxyPath,
    nextConfigPath,
    errorBoundaryPath,
    nextMajor,
    language,
  };
}
