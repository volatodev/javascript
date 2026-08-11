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

    await runWhoami();

    expect(write).toHaveBeenCalledWith("Authenticated with VOLATO_TOKEN.\n");
  });
});
