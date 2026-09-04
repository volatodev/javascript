import { promises as fs } from "node:fs";
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

const promptsMock = vi.fn();
const postJsonPublicMock = vi.fn();
const spawnMock = vi.fn(() => ({
  on: vi.fn().mockReturnThis(),
  unref: vi.fn(),
}));

vi.mock("prompts", () => ({
  default: (options: unknown) => promptsMock(options),
}));

vi.mock("node:child_process", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:child_process")>();
  return { ...original, spawn: (...args: unknown[]) => spawnMock(...args) };
});

vi.mock("../lib/api-client.js", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("../lib/api-client.js")>();
  return {
    ...original,
    postJsonPublic: (path: string, body: unknown) =>
      postJsonPublicMock(path, body),
  };
});

const { runLogin, runWhoami } = await import("../commands/login.js");

const originalIsTty = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
let credentialsFile: string | null = null;

function useInteractiveTerminal(): void {
  Object.defineProperty(process.stdin, "isTTY", {
    configurable: true,
    value: true,
  });
}

describe("runWhoami", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("recognizes the same VOLATO_TOKEN fallback as authenticated API calls", async () => {
    vi.stubEnv("VOLATO_TOKEN", "workspace-token");
    vi.stubEnv(
      "VOLATO_CREDENTIALS_FILE",
      "/tmp/volato-whoami-test/missing-credentials",
    );
    const write = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ data: { projects: [] } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    await runWhoami();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenCalledWith("Authenticated with VOLATO_TOKEN.\n");
  });

  it("refuses a present token that the API rejects", async () => {
    vi.stubEnv("VOLATO_TOKEN", "expired-workspace-token");
    vi.stubEnv(
      "VOLATO_CREDENTIALS_FILE",
      "/tmp/volato-whoami-test/missing-credentials",
    );
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          error: "invalid_token",
          message: "Invalid or expired token",
        }),
        { status: 401, headers: { "content-type": "application/json" } },
      ),
    );
    const stderr = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    vi.spyOn(process, "exit").mockImplementation(((code?: number | string | null) => {
      throw new Error(`exit:${code}`);
    }) as typeof process.exit);

    await expect(runWhoami()).rejects.toThrow("exit:3");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(stderr.mock.calls.flat().join(""))).toContain(
      "Invalid or expired token",
    );
  });
});

describe("runLogin", () => {
  afterEach(async () => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    promptsMock.mockReset();
    postJsonPublicMock.mockReset();
    spawnMock.mockClear();
    process.exitCode = undefined;
    if (originalIsTty) {
      Object.defineProperty(process.stdin, "isTTY", originalIsTty);
    } else {
      delete (process.stdin as NodeJS.ReadStream & { isTTY?: boolean }).isTTY;
    }
    if (credentialsFile) {
      await fs.unlink(credentialsFile).catch(() => undefined);
      await fs.unlink(`${credentialsFile}.login`).catch(() => undefined);
      credentialsFile = null;
    }
  });

  function useIsolatedCredentials(): string {
    credentialsFile = `/tmp/volato-login-${randomUUID()}/credentials`;
    vi.stubEnv("VOLATO_CREDENTIALS_FILE", credentialsFile);
    return credentialsFile;
  }

  it("keeps the same prompt alive after a stale code and accepts the current code", async () => {
    const file = useIsolatedCredentials();
    useInteractiveTerminal();
    promptsMock
      .mockResolvedValueOnce({ code: "vlt_stale" })
      .mockResolvedValueOnce({ code: "vlt_current" });
    postJsonPublicMock
      .mockResolvedValueOnce({
        ok: false,
        status: 400,
        error: "invalid_code",
        message: "That code is invalid, expired, or already used.",
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        data: { token: "fresh-workspace-token" },
      });
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    await runLogin({});

    expect(promptsMock).toHaveBeenCalledTimes(2);
    expect(postJsonPublicMock).toHaveBeenNthCalledWith(
      1,
      "/v1/auth/cli-exchange",
      { code: "vlt_stale" },
    );
    expect(postJsonPublicMock).toHaveBeenNthCalledWith(
      2,
      "/v1/auth/cli-exchange",
      { code: "vlt_current" },
    );
    expect(await fs.readFile(file, "utf8")).toBe("fresh-workspace-token\n");
    await expect(fs.access(`${file}.login`)).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("refuses a second browser flow while the first prompt is waiting", async () => {
    useIsolatedCredentials();
    useInteractiveTerminal();
    let finishFirst: ((answer: { code: string }) => void) | undefined;
    promptsMock.mockImplementationOnce(
      () =>
        new Promise<{ code: string }>((resolve) => {
          finishFirst = resolve;
        }),
    );
    const stderr = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);

    const first = runLogin({});
    await vi.waitFor(() => expect(promptsMock).toHaveBeenCalledTimes(1));
    await runLogin({});

    expect(spawnMock).toHaveBeenCalledTimes(1);
    expect(promptsMock).toHaveBeenCalledTimes(1);
    expect(String(stderr.mock.calls.flat().join(""))).toContain(
      "Another `volato login` is already waiting",
    );

    finishFirst?.({ code: "" });
    await first;
  });
});
