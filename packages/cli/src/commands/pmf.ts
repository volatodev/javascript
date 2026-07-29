import { getJson, postJson } from "../lib/api-client.js";
import { exitCodeForStatus } from "../lib/exit.js";
import {
  printApiError,
  printSuccess,
  type OutputMode,
} from "../lib/output.js";
import {
  PMF_SCHEMA_VERSION,
  PMF_SKILL,
  readPmfConfig,
  validateProjectId,
} from "./pmf-contract.js";

export type PmfCommandOptions = {
  cwd: string;
  file?: string;
  projectId?: string;
  json?: boolean;
};

function mode(options: { json?: boolean }): OutputMode {
  return options.json ? "json" : "human";
}

function projectConfig(options: PmfCommandOptions) {
  const { config, path } = readPmfConfig(options.cwd, options.file);
  const projectId = options.projectId
    ? validateProjectId(options.projectId)
    : config.projectId;
  return {
    config: projectId === config.projectId ? config : { ...config, projectId },
    path,
    projectId,
  };
}

export async function runPmfSync(
  options: PmfCommandOptions,
): Promise<void> {
  const { config, projectId } = projectConfig(options);
  const response = await postJson(
    `/v1/projects/${encodeURIComponent(projectId)}/skills/${PMF_SKILL}/config`,
    {
      schemaVersion: PMF_SCHEMA_VERSION,
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

export async function runPmfReport(
  options: PmfCommandOptions,
): Promise<void> {
  const projectId = options.projectId
    ? validateProjectId(options.projectId)
    : readPmfConfig(options.cwd, options.file).config.projectId;
  const response = await getJson(
    `/v1/projects/${encodeURIComponent(projectId)}/skills/${PMF_SKILL}/report`,
  );
  if (!response.ok) {
    printApiError(response);
    process.exit(exitCodeForStatus(response.status));
    return;
  }
  printSuccess(response, mode(options));
}

export function runPmfValidate(options: PmfCommandOptions): void {
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
    `# PMF config valid\n\n` +
      `- Project: ${config.projectId}\n` +
      `- Skill: ${config.skill}\n` +
      `- Events: ${config.events.length}\n` +
      `- File: ${path}\n`,
  );
}
