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
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import { dirname } from "node:path";
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
const LOGIN_LEASE_MAX_AGE_MS = 15 * 60 * 1000;

type LoginLeaseOwner = {
  pid: number;
  nonce: string;
  createdAt: string;
};

type LoginLease =
  | { acquired: false; ownerPid: number | null }
  | { acquired: true; release: () => Promise<void> };

function appBaseUrl(): string {
  return (process.env.VOLATO_APP_URL ?? DEFAULT_APP_URL).replace(/\/+$/, "");
}

function loginLeasePath(): string {
  return `${credentialsLocation()}.login`;
}

function parseLoginLease(raw: string): LoginLeaseOwner | null {
  try {
    const value = JSON.parse(raw) as Partial<LoginLeaseOwner>;
    if (
      typeof value.pid !== "number" ||
      !Number.isInteger(value.pid) ||
      value.pid <= 0 ||
      typeof value.nonce !== "string" ||
      value.nonce.length === 0 ||
      typeof value.createdAt !== "string"
    ) {
      return null;
    }
    return value as LoginLeaseOwner;
  } catch {
    return null;
  }
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

async function acquireLoginLease(): Promise<LoginLease> {
  const file = loginLeasePath();
  await fs.mkdir(dirname(file), { recursive: true, mode: 0o700 });

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const owner: LoginLeaseOwner = {
      pid: process.pid,
      nonce: randomUUID(),
      createdAt: new Date().toISOString(),
    };
    try {
      const handle = await fs.open(file, "wx", 0o600);
      try {
        await handle.writeFile(`${JSON.stringify(owner)}\n`);
      } finally {
        await handle.close();
      }
      return {
        acquired: true,
        release: async () => {
          try {
            const current = parseLoginLease(await fs.readFile(file, "utf8"));
            if (current?.nonce === owner.nonce) await fs.unlink(file);
          } catch (err) {
            if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
          }
        },
      };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
    }

    let current: LoginLeaseOwner | null = null;
    try {
      current = parseLoginLease(await fs.readFile(file, "utf8"));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw err;
    }
    const createdAt = current ? Date.parse(current.createdAt) : Number.NaN;
    const fresh = Number.isFinite(createdAt)
      ? Date.now() - createdAt < LOGIN_LEASE_MAX_AGE_MS
      : false;
    if (current && fresh && processIsAlive(current.pid)) {
      return { acquired: false, ownerPid: current.pid };
    }
    try {
      await fs.unlink(file);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
  }

  return { acquired: false, ownerPid: null };
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

  // 3. Interactive browser code flow. Keep one process as the unambiguous
  // owner of the human handoff; a second agent command must return to this
  // prompt instead of opening another browser page with another code.
  const lease = await acquireLoginLease();
  if (!lease.acquired) {
    const owner = lease.ownerPid ? ` (process ${lease.ownerPid})` : "";
    printLocalError(
      `Another \`volato login\` is already waiting${owner}. Return to that terminal and paste the current browser code there.`,
    );
    process.exitCode = EXIT.GENERAL;
    return;
  }

  try {
    const url = `${appBaseUrl()}/cli`;
    process.stderr.write(
      `Opening ${url}\n` +
        `  Keep this command running while you sign in.\n` +
        `  Copy the current browser code and paste it into this same prompt.\n` +
        `  (If the browser didn't open, paste that URL in manually.)\n`,
    );
    tryOpenBrowser(url);

    while (true) {
      const answer = await prompts({
        type: "text",
        name: "code",
        message: "Current login code:",
      });
      const code = typeof answer.code === "string" ? answer.code.trim() : "";
      if (!code) {
        printLocalError("Cancelled. No code entered.");
        process.exitCode = EXIT.GENERAL;
        return;
      }

      const resp = await postJsonPublic<{ token?: string }>(
        "/v1/auth/cli-exchange",
        { code },
      );
      const exchanged =
        resp.ok && typeof resp.data?.token === "string" ? resp.data.token : null;
      if (exchanged) {
        await storeAndConfirm(exchanged);
        return;
      }

      printApiError(resp);
      if (resp.error !== "invalid_code") {
        process.exitCode = exitCodeForStatus(resp.status);
        return;
      }
      process.stderr.write(
        "  Login is still waiting. Paste the current code from the open browser page, or press Ctrl+C to cancel.\n",
      );
    }
  } finally {
    await lease.release();
  }
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
