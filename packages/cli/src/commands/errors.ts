/**
 * `volato errors *` — thin HTTP wrappers on the agent API.
 *
 * The API does the agent-ready formatting; the CLI is just transport
 * + output mode. Default is "human" (markdown to stdout, colored
 * status to stderr); `--json` swaps in the structured payload from
 * the envelope's `data` field for scripts.
 */
import type {
  GetErrorContextInput,
  GetErrorSamplesInput,
  SearchErrorGroupsInput,
} from "@volatodev/read-client";
import { CliError, postJson } from "../lib/api-client.js";
import { readApi } from "../lib/read-client.js";
import { exitCodeForStatus } from "../lib/exit.js";
import {
  printApiError,
  printSuccess,
  type OutputMode,
} from "../lib/output.js";

export async function runErrorsList(opts: {
  status?: string;
  release?: string;
  baselineRelease?: string;
  environment?: string;
  query?: string;
  fingerprint?: string;
  runtime?: string;
  route?: string;
  firstSeenAfter?: string;
  firstSeenBefore?: string;
  lastSeenAfter?: string;
  lastSeenBefore?: string;
  minEvents?: number;
  minUsers?: number;
  sort?: string;
  projectId?: string;
  limit?: number;
  cursor?: string;
  json?: boolean;
}): Promise<void> {
  const mode: OutputMode = opts.json ? "json" : "human";
  const input = {
    status: opts.status,
    release: opts.release,
    baselineRelease: opts.baselineRelease,
    environment: opts.environment ?? "production",
    query: opts.query,
    fingerprint: opts.fingerprint,
    runtime: opts.runtime,
    route: opts.route,
    firstSeenAfter: opts.firstSeenAfter,
    firstSeenBefore: opts.firstSeenBefore,
    lastSeenAfter: opts.lastSeenAfter,
    lastSeenBefore: opts.lastSeenBefore,
    minEvents: opts.minEvents,
    minUsers: opts.minUsers,
    sort: opts.sort,
    projectId: opts.projectId,
    limit: opts.limit,
    cursor: opts.cursor,
  } as SearchErrorGroupsInput;
  const resp = await readApi((client) => client.searchErrorGroups(input));
  if (!resp.ok) {
    printApiError(resp);
    process.exit(exitCodeForStatus(resp.status));
    return;
  }
  printSuccess(resp, mode);
}

export async function runErrorSamples(opts: {
  id: string;
  projectId?: string;
  environment?: string;
  release?: string;
  runtime?: string;
  route?: string;
  strategy?: string;
  limit?: number;
  json?: boolean;
}): Promise<void> {
  const mode: OutputMode = opts.json ? "json" : "human";
  const input = {
    id: opts.id,
    projectId: opts.projectId,
    environment: opts.environment ?? "production",
    release: opts.release,
    runtime: opts.runtime,
    route: opts.route,
    strategy: opts.strategy,
    limit: opts.limit,
  } as GetErrorSamplesInput;
  const resp = await readApi((client) => client.getErrorSamples(input));
  if (!resp.ok) {
    printApiError(resp);
    process.exit(exitCodeForStatus(resp.status));
    return;
  }
  printSuccess(resp, mode);
}

export async function runErrorsShow(opts: {
  id?: string;
  projectId?: string;
  environment?: string;
  json?: boolean;
}): Promise<void> {
  const mode: OutputMode = opts.json ? "json" : "human";
  // `id` is optional: omitting it returns the most recent unresolved
  // group across the workspace (or scoped to `projectId` if set).
  // That's the painkiller path for "fix the last error".
  const input = {
    id: opts.id,
    projectId: opts.projectId,
    environment: opts.environment ?? "production",
  } as GetErrorContextInput;
  const resp = await readApi((client) => client.getErrorContext(input));
  if (!resp.ok) {
    printApiError(resp);
    process.exit(exitCodeForStatus(resp.status));
    return;
  }
  printSuccess(resp, mode);
}

export async function runErrorsResolve(opts: {
  id: string;
  action: "resolved" | "ignored" | "reopened";
  note?: string;
  json?: boolean;
}): Promise<void> {
  const mode: OutputMode = opts.json ? "json" : "human";
  const note = opts.note?.trim();
  if (!note) {
    throw new CliError(
      "A factual --note is required for resolve, reopen, and ignore actions.",
    );
  }
  const resp = await postJson(`/v1/errors/${encodeURIComponent(opts.id)}/resolve`, {
    action: opts.action,
    note,
  });
  if (!resp.ok) {
    printApiError(resp);
    process.exit(exitCodeForStatus(resp.status));
    return;
  }
  printSuccess(resp, mode);
}
