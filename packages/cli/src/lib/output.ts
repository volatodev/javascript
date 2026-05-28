/**
 * Output helpers shared by every command.
 *
 * Two modes:
 *   - **human** (default): markdown printed to stdout, colored status
 *     to stderr. The API's `markdown` field is already agent-ready, so
 *     we pipe it through unchanged.
 *   - **--json**: prints the API's `data` field as compact JSON. When
 *     the command is a mutation, prints the full envelope including
 *     the markdown line so scripts can grep on the human message too.
 */
import pc from "picocolors";
import type { ApiResponse } from "./api-client.js";

export type OutputMode = "human" | "json";

export function printSuccess(
  resp: ApiResponse<unknown>,
  mode: OutputMode,
): void {
  if (mode === "json") {
    process.stdout.write(
      `${JSON.stringify({ data: resp.data ?? null, markdown: resp.markdown ?? null })}\n`,
    );
    return;
  }
  if (resp.markdown) {
    process.stdout.write(`${resp.markdown}\n`);
  }
}

export function printApiError(resp: ApiResponse<unknown>): void {
  const status = resp.status;
  const error = resp.error ?? "unknown_error";
  const detail = resp.message ?? resp.markdown;
  process.stderr.write(`${pc.red("volato:")} ${error} (${status})\n`);
  if (detail) {
    process.stderr.write(`${detail}\n`);
  }
}

export function printLocalError(message: string): void {
  process.stderr.write(`${pc.red("volato:")} ${message}\n`);
}

export function printOk(message: string): void {
  process.stderr.write(`${pc.green("✓")} ${message}\n`);
}
