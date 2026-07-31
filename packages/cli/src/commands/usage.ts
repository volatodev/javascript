import { randomUUID } from "node:crypto";
import { getJson, postJson } from "../lib/api-client.js";
import { exitCodeForStatus } from "../lib/exit.js";
import {
  printApiError,
  printSuccess,
  type OutputMode,
} from "../lib/output.js";
import {
  USAGE_SCHEMA_VERSION,
  USAGE_SKILL,
  readUsageSnapshot,
  readUsageConfig,
  validateProjectId,
} from "./usage-contract.js";

export type UsageCommandOptions = {
  cwd: string;
  file?: string;
  projectId?: string;
  json?: boolean;
};

export type UsageSnapshotCommandOptions = {
  cwd: string;
  file?: string;
  projectId?: string;
  json?: boolean;
};

function mode(options: { json?: boolean }): OutputMode {
  return options.json ? "json" : "human";
}

function projectConfig(options: UsageCommandOptions) {
  const { config, path } = readUsageConfig(options.cwd, options.file);
  const projectId = options.projectId
    ? validateProjectId(options.projectId)
    : config.projectId;
  return {
    config: projectId === config.projectId ? config : { ...config, projectId },
    path,
    projectId,
  };
}

export async function runUsageSync(
  options: UsageCommandOptions,
): Promise<void> {
  const { config, projectId } = projectConfig(options);
  const response = await postJson(
    `/v1/projects/${encodeURIComponent(projectId)}/skills/${USAGE_SKILL}/config`,
    {
      schemaVersion: USAGE_SCHEMA_VERSION,
      config,
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
  const projectId = options.projectId
    ? validateProjectId(options.projectId)
    : readUsageConfig(options.cwd, options.file).config.projectId;
  const response = await getJson(
    `/v1/projects/${encodeURIComponent(projectId)}/skills/${USAGE_SKILL}/report`,
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
  const projectId = options.projectId
    ? validateProjectId(options.projectId)
    : readUsageConfig(options.cwd).config.projectId;
  const response = await postJson(
    `/v1/projects/${encodeURIComponent(projectId)}/skills/${USAGE_SKILL}/snapshots`,
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
    skill: config.skill,
    eventCount: config.events.length,
    file: path,
  };
  if (options.json) {
    process.stdout.write(`${JSON.stringify({ data })}\n`);
    return;
  }
  process.stdout.write(
    `# Product usage config valid\n\n` +
      `- Project: ${config.projectId}\n` +
      `- Skill: ${config.skill}\n` +
      `- Events: ${config.events.length}\n` +
      `- File: ${path}\n`,
  );
}
