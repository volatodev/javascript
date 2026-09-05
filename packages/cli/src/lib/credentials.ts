/**
 * On-disk credential store for the `volato` CLI.
 *
 * The token lives at `~/.config/volato/credentials` (mode 0600). One
 * bearer per machine — Day 1 we don't have multi-profile (the
 * workspace-scoped token already covers every project the user can
 * read, so a profile would only matter for users with several
 * workspaces; that's a later workspace-switching problem).
 *
 * The format is a single newline-terminated line: `token\n`. Plain
 * text on purpose — the only thing we'd "encrypt" against is a
 * coworker poking around in `$HOME`, and the same coworker would have
 * the token in process memory the moment the CLI runs anyway. The
 * file mode is the actual gate.
 *
 * Override the location with `VOLATO_CREDENTIALS_FILE` (tests, CI,
 * sandboxes that don't have a real $HOME).
 */
import { constants, promises as fs } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

function credentialsPath(): string {
  const override = process.env.VOLATO_CREDENTIALS_FILE;
  if (override && override.length > 0) return override;
  // Honour XDG_CONFIG_HOME when set — common on Linux dev setups
  // that move config out of `$HOME/.config` (e.g. dotfile managers).
  const xdg = process.env.XDG_CONFIG_HOME;
  const base = xdg && xdg.length > 0 ? xdg : join(homedir(), ".config");
  return join(base, "volato", "credentials");
}

export async function readToken(): Promise<string | null> {
  const file = credentialsPath();
  try {
    const raw = await fs.readFile(file, "utf8");
    const token = raw.trim();
    return token.length > 0 ? token : null;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

export async function writeToken(token: string): Promise<string> {
  const file = credentialsPath();
  await fs.mkdir(dirname(file), { recursive: true, mode: 0o700 });
  // Only the default Volato directory is ours to chmod. An explicit override
  // may live directly in a shared directory such as /tmp or the user's home.
  if (!process.env.VOLATO_CREDENTIALS_FILE) {
    if (!(await fs.lstat(dirname(file))).isDirectory()) {
      throw new Error("The Volato credentials directory must not be a symlink.");
    }
    await fs.chmod(dirname(file), 0o700);
  }
  // Creation mode does not repair existing files. Refuse links, then chmod
  // the opened file before truncating it or writing any new credential bytes.
  const handle = await fs.open(file, constants.O_WRONLY | constants.O_CREAT | constants.O_NOFOLLOW | constants.O_NONBLOCK, 0o600);
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.nlink !== 1) {
      throw new Error("Credentials must be stored in a regular, unlinked file.");
    }
    await handle.chmod(0o600);
    await handle.truncate(0);
    await handle.writeFile(`${token}\n`);
  } finally {
    await handle.close();
  }
  return file;
}

export async function deleteToken(): Promise<boolean> {
  const file = credentialsPath();
  try {
    await fs.unlink(file);
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw err;
  }
}

export function credentialsLocation(): string {
  return credentialsPath();
}
