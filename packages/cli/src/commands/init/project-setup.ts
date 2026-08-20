import { CliError, getJson, postJson } from "../../lib/api-client.js";
import { exitCodeForStatus } from "../../lib/exit.js";

export type ProjectSetupBundle = {
  projectId: string;
  projectName: string;
  dsn: string;
  ingestToken: string;
};

function isSetupBundle(value: unknown): value is ProjectSetupBundle {
  if (!value || typeof value !== "object") return false;
  const bundle = value as Record<string, unknown>;
  return (
    typeof bundle.projectId === "string" &&
    typeof bundle.projectName === "string" &&
    typeof bundle.dsn === "string" &&
    typeof bundle.ingestToken === "string" &&
    bundle.projectId.length > 0 &&
    bundle.dsn.length > 0 &&
    bundle.ingestToken.length > 0
  );
}

export async function fetchProjectSetup(
  projectId: string,
): Promise<ProjectSetupBundle> {
  const response = await getJson<ProjectSetupBundle>(
    `/v1/projects/${encodeURIComponent(projectId)}/setup`,
  );
  if (!response.ok) {
    throw new CliError(
      response.message ??
        response.error ??
        `Could not load setup for project ${projectId}.`,
      exitCodeForStatus(response.status),
    );
  }
  if (!isSetupBundle(response.data)) {
    throw new CliError("Volato returned an invalid project setup bundle.");
  }
  return response.data;
}

export async function markProjectLinked(projectId: string): Promise<{
  linked: boolean;
}> {
  const response = await postJson<{
    projectId: string;
    linked: boolean;
  }>(
    `/v1/projects/${encodeURIComponent(projectId)}/linked`,
    {},
  );
  if (!response.ok) {
    throw new CliError(
      response.message ??
        response.error ??
        `Could not mark project ${projectId} as linked.`,
      exitCodeForStatus(response.status),
    );
  }
  if (
    !response.data ||
    response.data.projectId !== projectId ||
    response.data.linked !== true
  ) {
    throw new CliError("Volato returned an invalid project link response.");
  }
  return {
    linked: response.data.linked,
  };
}

/**
 * Tell Volato a generated adapter now exists in this repository.
 *
 * Reporting failures never fail the init: the files are already written and
 * the integration works whether or not the signal lands. `/setup` cannot serve
 * this purpose because `volato init` calls it too, before anything is
 * generated.
 */
export async function reportIntegrationInstalled(
  projectId: string,
  adapter: "errors-nextjs" | "errors-vite-react" | "errors-node",
): Promise<void> {
  try {
    await postJson(
      `/v1/projects/${encodeURIComponent(projectId)}/integrations/${adapter}`,
      {},
    );
  } catch {
    // Best effort by design.
  }
}
