/** `volato releases *` — bounded read-only release primitives. */
import { getJson } from "../lib/api-client.js";
import { exitCodeForStatus } from "../lib/exit.js";
import {
  printApiError,
  printSuccess,
  type OutputMode,
} from "../lib/output.js";

type ReleaseScope = {
  projectId?: string;
  environment?: string;
  runtime?: string;
  limit?: number;
  json?: boolean;
};

export async function runReleasesList(opts: ReleaseScope): Promise<void> {
  const mode: OutputMode = opts.json ? "json" : "human";
  const resp = await getJson("/v1/releases", {
    projectId: opts.projectId,
    environment: opts.environment ?? "production",
    runtime: opts.runtime,
    limit: opts.limit,
  });
  if (!resp.ok) {
    printApiError(resp);
    process.exit(exitCodeForStatus(resp.status));
    return;
  }
  printSuccess(resp, mode);
}

export async function runReleasesCompare(
  opts: ReleaseScope & { head?: string; base?: string },
): Promise<void> {
  const mode: OutputMode = opts.json ? "json" : "human";
  const resp = await getJson("/v1/releases/compare", {
    head: opts.head,
    base: opts.base,
    projectId: opts.projectId,
    environment: opts.environment ?? "production",
    runtime: opts.runtime,
    limit: opts.limit,
  });
  if (!resp.ok) {
    printApiError(resp);
    process.exit(exitCodeForStatus(resp.status));
    return;
  }
  printSuccess(resp, mode);
}
