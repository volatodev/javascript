import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { credentialsLocation, writeToken } from "../lib/credentials";

let directory: string;
beforeEach(async () => {
  directory = await fs.mkdtemp(join(tmpdir(), "volato-credential-mode-"));
  vi.stubEnv("XDG_CONFIG_HOME", directory);
  vi.stubEnv("VOLATO_CREDENTIALS_FILE", "");
});
afterEach(async () => { vi.unstubAllEnvs(); await fs.rm(directory, { recursive: true }); });

describe("credential storage permissions", () => {
  it("repairs an existing public directory and file before storing another token", async () => {
    const file = credentialsLocation();
    await fs.mkdir(dirname(file), { recursive: true });
    await fs.chmod(dirname(file), 0o755);
    await fs.writeFile(file, "old-synthetic-token");
    await fs.chmod(file, 0o644);
    await writeToken("new-synthetic-token");
    expect((await fs.stat(dirname(file))).mode & 0o777).toBe(0o700);
    expect((await fs.stat(file)).mode & 0o777).toBe(0o600);
    expect(await fs.readFile(file, "utf8")).toBe("new-synthetic-token\n");
  });

  it("refuses a symlink without overwriting its target", async () => {
    const file = credentialsLocation();
    await fs.mkdir(dirname(file), { recursive: true });
    const target = join(directory, "unrelated");
    await fs.writeFile(target, "preserve");
    await fs.symlink(target, file);
    await expect(writeToken("new-synthetic-token")).rejects.toThrow();
    expect(await fs.readFile(target, "utf8")).toBe("preserve");
  });

  it("does not chmod the shared parent of an explicit credentials override", async () => {
    await fs.chmod(directory, 0o755);
    const file = join(directory, "override");
    vi.stubEnv("VOLATO_CREDENTIALS_FILE", file);
    await writeToken("synthetic-token");
    expect((await fs.stat(directory)).mode & 0o777).toBe(0o755);
    expect((await fs.stat(file)).mode & 0o777).toBe(0o600);
  });
});
