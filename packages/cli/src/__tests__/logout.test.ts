import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runLogout } from "../commands/login";

let directory: string;
let file: string;
beforeEach(async () => {
  directory = await fs.mkdtemp(join(tmpdir(), "volato-logout-"));
  file = join(directory, "credentials");
  vi.stubEnv("VOLATO_CREDENTIALS_FILE", file);
  vi.stubEnv("VOLATO_TOKEN", "");
  vi.stubEnv("VOLATO_API_URL", "https://api.example.test");
  vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  vi.spyOn(process.stderr, "write").mockImplementation(() => true);
});
afterEach(async () => { vi.restoreAllMocks(); vi.unstubAllEnvs(); process.exitCode = undefined; await fs.rm(directory, { recursive: true }); });

describe("logout revocation", () => {
  it("revokes the stored bearer before removing its file", async () => {
    await fs.writeFile(file, "stored-token\n");
    const request = vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      expect(await fs.readFile(file, "utf8")).toBe("stored-token\n");
      expect(url).toBe("https://api.example.test/v1/auth/cli-logout");
      expect(init?.method).toBe("POST");
      expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer stored-token");
      return Response.json({ data: { revoked: true } });
    });
    await runLogout();
    expect(request).toHaveBeenCalledOnce();
    await expect(fs.stat(file)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it.each([404, 429, 500])("preserves the credential and fails explicitly on HTTP %s", async (status) => {
    await fs.writeFile(file, "stored-token\n");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ error: "unavailable" }, { status }));
    await expect(runLogout()).rejects.toThrow(/revocation/i);
    expect(await fs.readFile(file, "utf8")).toBe("stored-token\n");
  });

  it("removes a token already rejected by the server", async () => {
    await fs.writeFile(file, "revoked-token\n");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ error: "invalid_token" }, { status: 401 }));
    await runLogout();
    await expect(fs.stat(file)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("revokes the active environment token while preserving a different stored credential", async () => {
    await fs.writeFile(file, "other-token\n");
    vi.stubEnv("VOLATO_TOKEN", "environment-token");
    const request = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ data: { revoked: true } }));
    await runLogout();
    expect((request.mock.calls[0]?.[1]?.headers as Record<string, string>).Authorization).toBe("Bearer environment-token");
    expect(await fs.readFile(file, "utf8")).toBe("other-token\n");
  });

  it("is idempotent with no active credential", async () => {
    const request = vi.spyOn(globalThis, "fetch");
    await runLogout();
    expect(request).not.toHaveBeenCalled();
  });

  it("keeps the local token on network failure or an unconfirmed success response", async () => {
    await fs.writeFile(file, "stored-token\n");
    const request = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network unavailable"));
    await expect(runLogout()).rejects.toThrow(/revocation/i);
    expect(await fs.readFile(file, "utf8")).toBe("stored-token\n");
    request.mockResolvedValue(Response.json({}));
    await expect(runLogout()).rejects.toThrow(/revocation/i);
    expect(await fs.readFile(file, "utf8")).toBe("stored-token\n");
  });

  it("keeps a replacement token written while revocation was pending", async () => {
    await fs.writeFile(file, "stored-token\n");
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      await fs.writeFile(file, "replacement-token\n");
      return Response.json({ data: { revoked: true } });
    });
    await runLogout();
    expect(await fs.readFile(file, "utf8")).toBe("replacement-token\n");
  });
});
