/** `volato releases *` — bounded read-only release primitives. */
import type {
  CompareReleasesInput,
  ListReleasesInput,
} from "@volatodev/read-client";
import { readApi } from "../lib/read-client.js";
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
  cursor?: string;
  json?: boolean;
};

export async function runReleasesList(opts: ReleaseScope): Promise<void> {
  const mode: OutputMode = opts.json ? "json" : "human";
  const input = {
    projectId: opts.projectId,
    environment: opts.environment ?? "production",
    runtime: opts.runtime,
    limit: opts.limit,
    cursor: opts.cursor,
  } as ListReleasesInput;
  const resp = await readApi((client) => client.listReleases(input));
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
  const input = {
    head: opts.head,
    base: opts.base,
    projectId: opts.projectId,
    environment: opts.environment ?? "production",
    runtime: opts.runtime,
    limit: opts.limit,
    cursor: opts.cursor,
  } as CompareReleasesInput;
  const resp = await readApi((client) => client.compareReleases(input));
  if (!resp.ok) {
    printApiError(resp);
    process.exit(exitCodeForStatus(resp.status));
    return;
  }
  printSuccess(resp, mode);
}
