import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  detectVolatoRelease,
  uploadVolatoBrowserSourceMaps,
  volatoReleaseIsExplicit,
} from "./artifact.mjs";

const projectRoot = process.cwd();
const allowedLocalKeys = new Set([
  "VOLATO_DSN",
  "VOLATO_ENVIRONMENT",
  "VOLATO_INGEST_TOKEN",
  "VOLATO_RELEASE",
]);

function unquote(value) {
  const trimmed = value.trim();
  if (
    trimmed.length >= 2 &&
    ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'")))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function localEnvironment() {
  const values = {};
  const path = join(projectRoot, ".env.local");
  if (!existsSync(path)) return values;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const match = /^([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (!match || !allowedLocalKeys.has(match[1])) continue;
    values[match[1]] = unquote(match[2]);
  }
  return values;
}

function value(name, local) {
  return process.env[name]?.trim() || local[name]?.trim() || undefined;
}

function angularOutputRoot() {
  const workspace = JSON.parse(
    readFileSync(join(projectRoot, "angular.json"), "utf8"),
  );
  const applications = Object.entries(workspace.projects ?? {}).filter(
    ([, project]) => project?.projectType === "application",
  );
  if (applications.length !== 1) {
    throw new Error(
      "[Volato] Angular build requires exactly one application project.",
    );
  }
  return join(projectRoot, "dist", applications[0][0]);
}

const local = localEnvironment();
const dsn = value("VOLATO_DSN", local);
const ingestToken = value("VOLATO_INGEST_TOKEN", local);
const environment = value("VOLATO_ENVIRONMENT", local) ?? "production";
const explicitRelease = value("VOLATO_RELEASE", local);
const release = detectVolatoRelease(explicitRelease);
const browserConfig = {
  ...(dsn ? { dsn } : {}),
  environment,
  ...(release ? { release } : {}),
  enabled: environment !== "development",
};
const ngPath = join(
  projectRoot,
  "node_modules",
  "@angular",
  "cli",
  "bin",
  "ng.js",
);
if (!existsSync(ngPath)) {
  throw new Error(
    "[Volato] Local Angular CLI is missing. Install repository dependencies before building.",
  );
}
const build = spawnSync(
  process.execPath,
  [
    ngPath,
    "build",
    ...process.argv.slice(2),
    "--define",
    `__VOLATO_BROWSER_CONFIG__=${JSON.stringify(browserConfig)}`,
  ],
  { cwd: projectRoot, env: process.env, stdio: "inherit" },
);
if (build.error) throw build.error;
if (build.status !== 0) process.exit(build.status ?? 1);

await uploadVolatoBrowserSourceMaps({
  adapter: "Angular",
  outDir: angularOutputRoot(),
  projectRoot,
  dsn,
  ingestToken,
  release,
  releaseWasExplicit: volatoReleaseIsExplicit(explicitRelease),
});
