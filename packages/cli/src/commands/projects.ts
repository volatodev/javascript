/**
 * Agent-facing project configuration commands.
 *
 * Allowed origins are replaced wholesale so the command is deterministic and
 * safe to re-run. The API remains authoritative; local validation only keeps
 * obvious mistakes from consuming a network round-trip.
 */
import type { ListProjectsInput } from "@volatodev/read-client";
import { CliError, postJson } from "../lib/api-client.js";
import { exitCodeForStatus } from "../lib/exit.js";
import { readApi } from "../lib/read-client.js";
import {
  printApiError,
  printSuccess,
  type OutputMode,
} from "../lib/output.js";

const MAX_ALLOWED_ORIGINS = 20;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function runProjectsList(opts: {
  limit?: number;
  cursor?: string;
  json?: boolean;
}): Promise<void> {
  const input = { limit: opts.limit, cursor: opts.cursor } as ListProjectsInput;
  const response = await readApi((client) => client.listProjects(input));
  if (!response.ok) {
    printApiError(response);
    process.exit(exitCodeForStatus(response.status));
    return;
  }
  const mode: OutputMode = opts.json ? "json" : "human";
  printSuccess(response, mode);
}

export function normaliseProjectOrigins(inputs: string[]): string[] {
  if (inputs.length > MAX_ALLOWED_ORIGINS) {
    throw new CliError(
      `At most ${MAX_ALLOWED_ORIGINS} origins may be configured.`,
    );
  }

  const origins: string[] = [];
  const seen = new Set<string>();
  for (const input of inputs) {
    const trimmed = input.trim();
    let url: URL;
    try {
      url = new URL(trimmed);
    } catch {
      throw invalidOrigin(input);
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw invalidOrigin(input);
    }
    if (!seen.has(url.origin)) {
      seen.add(url.origin);
      origins.push(url.origin);
    }
  }
  return origins;
}

function invalidOrigin(input: string): CliError {
  return new CliError(
    `Invalid origin ${JSON.stringify(input)}. Use a full http:// or https:// origin.`,
  );
}

export async function runProjectOriginsSet(opts: {
  projectId: string;
  origins: string[];
  clear?: boolean;
  json?: boolean;
}): Promise<void> {
  if (!UUID.test(opts.projectId)) {
    throw new CliError("A valid project id is required.");
  }
  if (opts.clear && opts.origins.length > 0) {
    throw new CliError("Do not pass origins together with --clear.");
  }
  if (!opts.clear && opts.origins.length === 0) {
    throw new CliError("Pass at least one origin, or use --clear.");
  }

  const origins = opts.clear ? [] : normaliseProjectOrigins(opts.origins);
  const response = await postJson(
    `/v1/projects/${encodeURIComponent(opts.projectId)}/allowed-origins`,
    { origins },
  );
  if (!response.ok) {
    printApiError(response);
    process.exit(exitCodeForStatus(response.status));
    return;
  }

  const mode: OutputMode = opts.json ? "json" : "human";
  printSuccess(response, mode);
}
