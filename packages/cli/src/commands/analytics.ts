import { randomUUID } from "node:crypto";
import { getJson, postJson } from "../lib/api-client.js";
import { exitCodeForStatus } from "../lib/exit.js";
import {
  printApiError,
  printSuccess,
  type OutputMode,
} from "../lib/output.js";
import {
  ANALYTICS_BACKEND_SKILL,
  USAGE_SCHEMA_VERSION,
  readUsageSnapshot,
  readUsageConfig,
} from "./analytics-contract.js";
import { linkedProject } from "../integrations/manifest.js";

export type UsageCommandOptions = {
  cwd: string;
  file?: string;
  json?: boolean;
};

export type UsageSnapshotCommandOptions = {
  cwd: string;
  file?: string;
  json?: boolean;
};

function mode(options: { json?: boolean }): OutputMode {
  return options.json ? "json" : "human";
}

function projectConfig(options: UsageCommandOptions) {
  const { config, path } = readUsageConfig(options.cwd, options.file);
  const projectId = linkedProject(options.cwd).id;
  if (config.projectId !== projectId) {
    throw new Error(
      `Analytics config project ${config.projectId} does not match linked Volato project ${projectId}.`,
    );
  }
  return {
    config,
    path,
    projectId,
  };
}

export async function runUsageSync(
  options: UsageCommandOptions,
): Promise<void> {
  const { config, projectId } = projectConfig(options);
  const response = await postJson(
    `/v1/projects/${encodeURIComponent(projectId)}/skills/${ANALYTICS_BACKEND_SKILL}/config`,
    {
      schemaVersion: USAGE_SCHEMA_VERSION,
      config: { ...config, skill: ANALYTICS_BACKEND_SKILL },
    },
  );
  if (!response.ok) {
    printApiError(response);
    process.exit(exitCodeForStatus(response.status));
    return;
  }
  printSuccess(response, mode(options));
}

export async function runUsageReport(
  options: UsageCommandOptions,
): Promise<void> {
  const { projectId } = projectConfig(options);
  const response = await getJson(
    `/v1/projects/${encodeURIComponent(projectId)}/skills/${ANALYTICS_BACKEND_SKILL}/report`,
  );
  if (!response.ok) {
    printApiError(response);
    process.exit(exitCodeForStatus(response.status));
    return;
  }
  printSuccess(response, mode(options));
}

export async function runUsageSnapshotSave(
  options: UsageSnapshotCommandOptions,
): Promise<void> {
  const { snapshot } = readUsageSnapshot(options.cwd, options.file);
  const { projectId } = projectConfig({ cwd: options.cwd });
  const response = await postJson(
    `/v1/projects/${encodeURIComponent(projectId)}/skills/${ANALYTICS_BACKEND_SKILL}/snapshots`,
    snapshot,
    { idempotencyKey: randomUUID() },
  );
  if (!response.ok) {
    printApiError(response);
    process.exit(exitCodeForStatus(response.status));
    return;
  }
  printSuccess(response, mode(options));
}

export function runUsageValidate(options: UsageCommandOptions): void {
  const { config, path } = projectConfig(options);
  const data = {
    valid: true,
    schemaVersion: config.schemaVersion,
    projectId: config.projectId,
    eventCount: config.events.length,
    file: path,
  };
  if (options.json) {
    process.stdout.write(`${JSON.stringify({ data })}\n`);
    return;
  }
  process.stdout.write(
    `# Product analytics config valid\n\n` +
      `- Project: ${config.projectId}\n` +
      `- Events: ${config.events.length}\n` +
      `- File: ${path}\n`,
  );
}
