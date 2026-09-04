/**
 * `volato login` — authenticate the CLI.
 *
 * Three paths, in priority order:
 *   1. Explicit token — `volato login <token>` (dashboard copy-paste)
 *      or `--stdin` (pipe it without leaking it in `ps`). Stored as-is.
 *   2. Interactive browser code flow (the default, à la Claude Code):
 *      open app.volato.dev/cli, the page shows a one-time code, paste
 *      it back; we exchange it for the workspace token.
 *   3. Non-interactive with no token — we DON'T hang on a prompt; we
 *      fail loudly pointing at VOLATO_TOKEN / --stdin.
 *
 * Headless callers (CI, agents) can skip `login` entirely: the API
 * client falls back to VOLATO_TOKEN from the environment.
 */
import { spawn } from "node:child_process";
import prompts from "prompts";
import { getJson, postJsonPublic } from "../lib/api-client.js";
import {
  credentialsLocation,
  deleteToken,
  readToken,
  writeToken,
} from "../lib/credentials.js";
import { EXIT, exitCodeForStatus } from "../lib/exit.js";
import { printApiError, printLocalError, printOk } from "../lib/output.js";

const DEFAULT_APP_URL = "https://app.volato.dev";

function appBaseUrl(): string {
  return (process.env.VOLATO_APP_URL ?? DEFAULT_APP_URL).replace(/\/+$/, "");
}

/** Best-effort browser open — never blocks or throws if it can't. */
function tryOpenBrowser(url: string): void {
  const [cmd, args] =
    process.platform === "darwin"
      ? ["open", [url]]
      : process.platform === "win32"
        ? ["cmd", ["/c", "start", "", url]]
        : ["xdg-open", [url]];
  try {
    const child = spawn(cmd as string, args as string[], {
      stdio: "ignore",
      detached: true,
    });
    child.on("error", () => {
      /* no opener available — the printed URL is the fallback */
    });
    child.unref();
  } catch {
    /* ignore */
  }
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

async function storeAndConfirm(token: string): Promise<void> {
  const file = await writeToken(token);
  printOk(`Token saved to ${file}`);
  process.stderr.write(
    `  Try: volato errors list\n  Discover: volato readme\n`,
  );
}

export async function runLogin(args: {
  token?: string;
  stdin?: boolean;
}): Promise<void> {
  // 1. Explicit token (scripted / CI). Positional arg keeps the
  //    dashboard copy-paste working; --stdin avoids `ps` exposure.
  let token = args.token?.trim();
  if (!token && args.stdin) token = (await readStdin()).trim();
  if (token) {
    await storeAndConfirm(token);
    return;
  }

  // 2. No token, no TTY → never hang on an unanswerable prompt.
  if (!process.stdin.isTTY) {
    printLocalError(
      "Non-interactive shell — can't run the browser login.\n" +
        "  Set VOLATO_TOKEN in the environment, or pipe a token:\n" +
        '    echo "$VOLATO_TOKEN" | volato login --stdin',
    );
    process.exit(EXIT.GENERAL);
    return;
  }

  // 3. Interactive browser code flow.
  const url = `${appBaseUrl()}/cli`;
  process.stderr.write(
    `Opening ${url}\n` +
      `  Sign in, copy the code it shows, and paste it below.\n` +
      `  (If the browser didn't open, paste that URL in manually.)\n`,
  );
  tryOpenBrowser(url);

  const answer = await prompts({
    type: "text",
    name: "code",
    message: "Login code:",
  });
  const code = typeof answer.code === "string" ? answer.code.trim() : "";
  if (!code) {
    printLocalError("Cancelled. No code entered.");
    process.exit(EXIT.GENERAL);
    return;
  }

  const resp = await postJsonPublic<{ token?: string }>(
    "/v1/auth/cli-exchange",
    { code },
  );
  const exchanged =
    resp.ok && typeof resp.data?.token === "string" ? resp.data.token : null;
  if (!exchanged) {
    printApiError(resp);
    process.exit(EXIT.AUTH);
    return;
  }
  await storeAndConfirm(exchanged);
}

export async function runWhoami(): Promise<void> {
  const environmentToken = process.env.VOLATO_TOKEN?.trim();
  const token = environmentToken || (await readToken());
  if (!token) {
    printLocalError(
      `No token found. Run \`volato login\` first.\n` +
        `  Looked at: ${credentialsLocation()}`,
    );
    process.exit(1);
    return;
  }

  // Reuse the smallest existing authenticated read rather than maintaining a
  // second identity endpoint. The response body is deliberately ignored:
  // `whoami` proves the bearer is live without exposing project data.
  const response = await getJson("/v1/projects", { limit: 1 });
  if (!response.ok) {
    printApiError(response);
    process.exit(exitCodeForStatus(response.status));
    return;
  }

  process.stdout.write(
    environmentToken
      ? "Authenticated with VOLATO_TOKEN.\n"
      : `Authenticated. Token stored at ${credentialsLocation()}.\n`,
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
