/**
 * Project detection. Pure functions — no I/O wrappers, just the rules — so
 * the shape can be unit-tested without touching the disk.
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
  /** Absolute path to the existing next.config.{ts,mjs,js,cjs}, or null. */
  nextConfigPath: string | null;
  /** Absolute path where the tunnel route should live (app/monitoring/route.{ts,js}). */
  tunnelRoutePath: string;
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

function hasNextDependency(pkg: Record<string, unknown>): boolean {
  const deps = pkg.dependencies;
  const devDeps = pkg.devDependencies;
  const inDeps =
    deps && typeof deps === "object" && "next" in (deps as object);
  const inDevDeps =
    devDeps && typeof devDeps === "object" && "next" in (devDeps as object);
  return Boolean(inDeps || inDevDeps);
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
  if (!hasNextDependency(pkg)) {
    throw new DetectionError(
      "Next.js is not listed in dependencies or devDependencies. Run `pnpm add next` first.",
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

  const nextConfigCandidates = [
    join(cwd, "next.config.ts"),
    join(cwd, "next.config.mjs"),
    join(cwd, "next.config.js"),
    join(cwd, "next.config.cjs"),
  ];
  const nextConfigPath =
    nextConfigCandidates.find((p) => existsSync(p)) ?? null;

  const tunnelRouteExt = language === "ts" ? "ts" : "js";
  const tunnelRoutePath = join(
    cwd,
    appDir,
    "monitoring",
    `route.${tunnelRouteExt}`,
  );

  return {
    cwd,
    appDir,
    layoutPath: layout.path,
    instrumentationPath,
    middlewarePath,
    nextConfigPath,
    tunnelRoutePath,
    language,
  };
}
