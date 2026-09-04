import { afterEach, describe, expect, it, vi } from "vitest";

import { runWhoami } from "../commands/login";

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
