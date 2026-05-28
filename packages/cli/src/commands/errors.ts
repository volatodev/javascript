/**
 * `volato errors *` — thin HTTP wrappers on the agent API.
 *
 * The API does the agent-ready formatting; the CLI is just transport
 * + output mode. Default is "human" (markdown to stdout, colored
 * status to stderr); `--json` swaps in the structured payload from
 * the envelope's `data` field for scripts.
 */
import { getJson, postJson } from "../lib/api-client.js";
import {
  printApiError,
  printSuccess,
  type OutputMode,
} from "../lib/output.js";

export async function runErrorsList(opts: {
  status?: string;
  release?: string;
  query?: string;
  projectId?: string;
  limit?: number;
  json?: boolean;
}): Promise<void> {
  const mode: OutputMode = opts.json ? "json" : "human";
  const resp = await getJson("/v1/errors", {
    status: opts.status,
    release: opts.release,
    query: opts.query,
    projectId: opts.projectId,
    limit: opts.limit,
  });
  if (!resp.ok) {
    printApiError(resp);
    process.exit(1);
    return;
  }
  printSuccess(resp, mode);
}

export async function runErrorsShow(opts: {
  id?: string;
  projectId?: string;
  json?: boolean;
}): Promise<void> {
  const mode: OutputMode = opts.json ? "json" : "human";
  // `id` is optional: omitting it returns the most recent unresolved
  // group across the workspace (or scoped to `projectId` if set).
  // That's the painkiller path for "fix the last error".
  const resp = await getJson("/v1/errors/context", {
    id: opts.id,
    projectId: opts.projectId,
  });
  if (!resp.ok) {
    printApiError(resp);
    process.exit(1);
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
  const resp = await postJson(`/v1/errors/${opts.id}/resolve`, {
    action: opts.action,
    note: opts.note,
  });
  if (!resp.ok) {
    printApiError(resp);
    process.exit(1);
    return;
  }
  printSuccess(resp, mode);
}
