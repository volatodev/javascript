/**
 * `volato login [token]` — write the workspace bearer to disk.
 *
 * If `token` is passed as an argument we skip the prompt. That's the
 * shape the dashboard's copy-paste snippet emits (`volato login XXX`),
 * and it's also the shape CI scripts use. Without the argument we
 * prompt interactively — handy for users typing the command from
 * memory after reading the docs.
 */
import prompts from "prompts";
import {
  credentialsLocation,
  deleteToken,
  readToken,
  writeToken,
} from "../lib/credentials.js";
import { printLocalError, printOk } from "../lib/output.js";

export async function runLogin(args: { token?: string }): Promise<void> {
  let token = args.token?.trim();
  if (!token) {
    const answer = await prompts({
      type: "password",
      name: "token",
      message: "Paste your Volato token (from https://app.volato.dev):",
    });
    token = typeof answer.token === "string" ? answer.token.trim() : "";
  }
  if (!token) {
    printLocalError("Cancelled. No token saved.");
    process.exit(1);
    return;
  }
  const file = await writeToken(token);
  printOk(`Token saved to ${file}`);
  process.stderr.write(
    `  Try: volato errors list\n` +
      `  Discover: volato readme\n`,
  );
}

export async function runWhoami(): Promise<void> {
  // Day 1 we don't round-trip to the API to verify — the token shape
  // is opaque and there's no /me endpoint yet. We just confirm a
  // token is present and where it lives. A real /whoami endpoint
  // (user email + workspace name) lands when we add the API call
  // in a follow-up.
  const token = await readToken();
  if (!token) {
    printLocalError(
      `No token found. Run \`volato login\` first.\n` +
        `  Looked at: ${credentialsLocation()}`,
    );
    process.exit(1);
    return;
  }
  process.stdout.write(
    `Authenticated. Token stored at ${credentialsLocation()}.\n`,
  );
}

export async function runLogout(): Promise<void> {
  const removed = await deleteToken();
  if (removed) {
    printOk(`Logged out. Token removed from ${credentialsLocation()}.`);
  } else {
    // Nothing to remove is success, not failure — `logout` is idempotent.
    printOk(`No token was stored (${credentialsLocation()}).`);
  }
}
