import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { UsageConfig } from "../commands/analytics-contract.js";
import type { ProjectShape } from "../commands/init/detect.js";
import { patchEnvLocal, type PatchOutcome } from "../commands/init/patch.js";
import {
  ANALYTICS_NEXTJS_INTEGRATION,
  createGeneratedIntegration,
  modifiedGeneratedFiles,
  readManifest,
  writeIntegration,
} from "./manifest.js";

export const ANALYTICS_NEXTJS_RECIPE_VERSION = "1.0.0";

export type GenerateAnalyticsNextjsOptions = {
  cwd: string;
  dsn: string;
  ingestToken: string;
  project: ProjectShape;
  config: UsageConfig;
  trackerSource?: string;
};

export type GenerateAnalyticsNextjsResult = {
  outcomes: PatchOutcome[];
  runtimeRoot: string;
  generatedFiles: string[];
  manifestPath: string;
};

export function assertAnalyticsNextjsWritable(cwd: string): void {
  const manifest = readManifest(cwd);
  if (!manifest) {
    throw new Error(
      "This repository is not connected to Volato. Run `volato init --project <id>` first.",
    );
  }
  const previous = manifest.integrations[ANALYTICS_NEXTJS_INTEGRATION];
  if (!previous) return;

  const modified = modifiedGeneratedFiles(cwd, previous);
  if (modified.length > 0) {
    throw new Error(
      `Generated Volato Analytics files were edited or deleted: ${modified.join(", ")}. Review those changes before updating the integration.`,
    );
  }
}

function bundledTracker(): string {
  return join(
    __dirname,
    "..",
    "skills",
    "volato-product",
    "assets",
    "analytics-tracker.ts",
  );
}

function catalogSource(config: UsageConfig): string {
  return (
    `import { createAnalyticsTracker } from "./tracker";\n\n` +
    `export const analyticsEvents = ${JSON.stringify(config.events, null, 2)} as const;\n\n` +
    `export const analytics = createAnalyticsTracker({ events: analyticsEvents });\n`
  );
}

export function generateAnalyticsNextjsIntegration(
  options: GenerateAnalyticsNextjsOptions,
): GenerateAnalyticsNextjsResult {
  if (options.project.language !== "ts") {
    throw new Error(
      "The generated Analytics recipe currently requires a TypeScript Next.js App Router project.",
    );
  }

  assertAnalyticsNextjsWritable(options.cwd);
  const previous = readManifest(options.cwd)?.integrations[
    ANALYTICS_NEXTJS_INTEGRATION
  ];

  const trackerSource = options.trackerSource ?? bundledTracker();
  if (!existsSync(trackerSource)) {
    throw new Error(`Analytics recipe asset is missing: ${trackerSource}`);
  }

  const volatoRoot =
    options.project.appDir === "src/app"
      ? join(options.cwd, "src", "volato")
      : join(options.cwd, "volato");
  const runtimeRoot = join(volatoRoot, "analytics");
  mkdirSync(runtimeRoot, { recursive: true });
  const trackerPath = join(runtimeRoot, "tracker.ts");
  const catalogPath = join(runtimeRoot, "index.ts");
  writeFileSync(trackerPath, readFileSync(trackerSource));
  writeFileSync(catalogPath, catalogSource(options.config), "utf8");
  const generatedFiles = [catalogPath, trackerPath];

  const outcomes = [
    patchEnvLocal(options.cwd, options.dsn, options.ingestToken),
    {
      path: runtimeRoot,
      status: previous ? "updated" : "created",
      detail: "typed Analytics tracker and event catalog",
    } satisfies PatchOutcome,
  ];
  const integration = createGeneratedIntegration(options.cwd, {
    recipe: "analytics-nextjs-app-router",
    recipeVersion: ANALYTICS_NEXTJS_RECIPE_VERSION,
    files: generatedFiles,
  });
  const path = writeIntegration(
    options.cwd,
    ANALYTICS_NEXTJS_INTEGRATION,
    integration,
  );

  return {
    outcomes,
    runtimeRoot,
    generatedFiles,
    manifestPath: path,
  };
}
