import prompts from "prompts";
import { CliError, postJson } from "../lib/api-client.js";
import { EXIT, exitCodeForStatus } from "../lib/exit.js";
import {
  printApiError,
  printLocalError,
  printSuccess,
  type OutputMode,
} from "../lib/output.js";

const MIN_MESSAGE_LENGTH = 5;
const MAX_MESSAGE_LENGTH = 4000;

export async function runFeedback(opts: {
  message: string;
  yes?: boolean;
  json?: boolean;
}): Promise<void> {
  const message = opts.message.trim();
  if (
    message.length < MIN_MESSAGE_LENGTH ||
    message.length > MAX_MESSAGE_LENGTH
  ) {
    throw new CliError(
      `Feedback must be between ${MIN_MESSAGE_LENGTH} and ${MAX_MESSAGE_LENGTH} characters.`,
    );
  }

  if (!opts.yes) {
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
      throw new CliError(
        "Feedback requires `--yes` in a non-interactive shell. Use it only after the human explicitly approves this exact message.",
      );
    }
    process.stderr.write(`Feedback to send:\n${message}\n\n`);
    const answer = await prompts({
      type: "confirm",
      name: "approved",
      message: "Did you approve sending this exact message?",
      initial: false,
    });
    if (answer.approved !== true) {
      printLocalError("Cancelled. Feedback was not sent.");
      process.exitCode = EXIT.GENERAL;
      return;
    }
  }

  const response = await postJson("/v1/feedback", { message });
  if (!response.ok) {
    printApiError(response);
    process.exitCode = exitCodeForStatus(response.status);
    return;
  }

  const mode: OutputMode = opts.json ? "json" : "human";
  printSuccess(response, mode);
}
