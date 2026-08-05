import pc from "picocolors";
import {
  ANALYTICS_BACKEND_SKILL,
  DEFAULT_USAGE_FILE,
  readUsageConfig,
  USAGE_SCHEMA_VERSION,
} from "../analytics-contract.js";
import {
  assertAnalyticsNextjsWritable,
  generateAnalyticsNextjsIntegration,
} from "../../integrations/analytics-nextjs.js";
import { linkedProject } from "../../integrations/manifest.js";
import { CliError, postJson } from "../../lib/api-client.js";
import { exitCodeForStatus } from "../../lib/exit.js";
import { detectProject, DetectionError } from "./detect.js";
import { ensureGitignoreCoversEnvLocal } from "./local-credentials.js";
import {
  fetchProjectSetup,
  reportIntegrationInstalled,
} from "./project-setup.js";

export type AnalyticsInitOptions = {
  cwd: string;
  file?: string;
  nonInteractive?: boolean;
};

export async function runAnalyticsInit(
  options: AnalyticsInitOptions,
): Promise<void> {
  process.stdout.write(
    `${pc.bold("volato")} analytics init  ${pc.dim(options.cwd)}\n\n`,
  );
  const projectLink = linkedProject(options.cwd);
  const { config, path: configPath } = readUsageConfig(
    options.cwd,
    options.file ?? DEFAULT_USAGE_FILE,
  );
  if (config.projectId !== projectLink.id) {
    throw new Error(
      `Analytics config project ${config.projectId} does not match linked Volato project ${projectLink.id}.`,
    );
  }

  let project;
  try {
    project = detectProject(options.cwd);
  } catch (error) {
    if (error instanceof DetectionError) throw new Error(error.message);
    throw error;
  }

  const setup = await fetchProjectSetup(projectLink.id);
  await ensureGitignoreCoversEnvLocal(
    options.cwd,
    options.nonInteractive,
  );
  assertAnalyticsNextjsWritable(options.cwd);

  const response = await postJson(
    `/v1/projects/${encodeURIComponent(projectLink.id)}/skills/${ANALYTICS_BACKEND_SKILL}/config`,
    {
      schemaVersion: USAGE_SCHEMA_VERSION,
      config: { ...config, skill: ANALYTICS_BACKEND_SKILL },
    },
  );
  if (!response.ok) {
    throw new CliError(
      response.message ??
        response.error ??
        "Could not publish the Analytics contract.",
      exitCodeForStatus(response.status),
    );
  }

  const generated = generateAnalyticsNextjsIntegration({
    cwd: options.cwd,
    dsn: setup.dsn,
    ingestToken: setup.ingestToken,
    project,
    config,
  });
  for (const outcome of generated.outcomes) {
    process.stdout.write(
      `  ${outcome.status.padEnd(7)} ${outcome.path}${outcome.detail ? ` — ${outcome.detail}` : ""}\n`,
    );
  }
  await reportIntegrationInstalled(projectLink.id, "analytics-nextjs");
  process.stdout.write(
    `\n${pc.green("✓")} Analytics initialized from ${pc.cyan(configPath)}.\n` +
      `  Import ${pc.cyan(
        project.appDir === "src/app"
          ? "@/volato/analytics"
          : "./volato/analytics",
      )} from authoritative server transitions.\n` +
      `  Run ${pc.cyan("volato analytics report")} after real events arrive.\n`,
  );
}
