/**
 * Project detection for `volato init`. Walks a customer's
 * Next.js project tree and figures out where the layout lives
 * (`app/` vs `src/app/`), whether they're on TypeScript or
 * JavaScript, where their `next.config.{ts,js,mjs,cjs}` is, and
 * whether they already have an `instrumentation.ts` / `middleware.ts`.
 *
 * Lives separately from `init.ts` and `patch.ts` so each rule is
 * a pure function with no I/O wrapper — the test suite hands it
 * a fixture tree on disk and asserts the resulting `ProjectShape`
 * without booting commander or prompting for a DSN.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export type AppRouterLocation = "app" | "src/app";

export type ProjectShape = {
  cwd: string;
  appDir: AppRouterLocation;
  layoutPath: string;
  instrumentationPath: string;
  middlewarePath: string | null;
  /** Next.js 16 Node-runtime request boundary (`proxy.ts` / `.js`). */
  proxyPath: string | null;
  /** Absolute path to the existing next.config.{ts,mjs,js,cjs}, or null. */
  nextConfigPath: string | null;
  /** Absolute path where the App Router render error boundary should live. */
  errorBoundaryPath: string;
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

  const appDir: AppRouterLocation = existsSync(join(cwd, "src", "app"))
    ? "src/app"
    : "app";

  const layout = findLayout(cwd, appDir);
  if (!layout) {
    throw new DetectionError(
      `No \`${appDir}/layout.tsx\` (or .jsx) found. Volato requires the App Router.`,
    );
  }

  const language: "ts" | "js" = layout.ext === "tsx" ? "ts" : "js";
  const instrumentationDir = appDir === "src/app" ? join(cwd, "src") : cwd;
  const instrumentationPath = join(
    instrumentationDir,
    `instrumentation.${language}`,
  );

  const middlewareCandidates = [
    join(cwd, "middleware.ts"),
    join(cwd, "middleware.js"),
    join(cwd, "src", "middleware.ts"),
    join(cwd, "src", "middleware.js"),
  ];
  const middlewarePath =
    middlewareCandidates.find((p) => existsSync(p)) ?? null;

  const proxyCandidates = [
    join(cwd, "proxy.ts"),
    join(cwd, "proxy.js"),
    join(cwd, "src", "proxy.ts"),
    join(cwd, "src", "proxy.js"),
  ];
  const proxyPath =
    nextMajor >= 16 ? proxyCandidates.find((p) => existsSync(p)) ?? null : null;

  const nextConfigCandidates = [
    join(cwd, "next.config.ts"),
    join(cwd, "next.config.mjs"),
    join(cwd, "next.config.js"),
    join(cwd, "next.config.cjs"),
  ];
  const nextConfigPath =
    nextConfigCandidates.find((p) => existsSync(p)) ?? null;

  const errorBoundaryPath = join(cwd, appDir, `error.${layout.ext}`);

  return {
    cwd,
    appDir,
    layoutPath: layout.path,
    instrumentationPath,
    middlewarePath,
    proxyPath,
    nextConfigPath,
    errorBoundaryPath,
    nextMajor,
    language,
  };
}
