import { beforeEach, describe, expect, it, vi } from "vitest";
import { EXIT } from "../lib/exit.js";

const getJson = vi.fn();

vi.mock("../lib/api-client.js", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("../lib/api-client.js")>();
  return {
    ...original,
    getJson: (path: string) => getJson(path),
  };
});

const { fetchProjectSetup } = await import(
  "../commands/init/project-setup.js"
);

beforeEach(() => {
  getJson.mockReset();
});

describe("fetchProjectSetup", () => {
  it("loads the authenticated setup bundle for one project", async () => {
    getJson.mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        projectId: "11111111-1111-4111-8111-111111111111",
        projectName: "Checkout",
        dsn: "https://public@api.volato.dev/11111111-1111-4111-8111-111111111111",
        ingestToken: "server-only-token",
      },
    });

    await expect(
      fetchProjectSetup("11111111-1111-4111-8111-111111111111"),
    ).resolves.toEqual({
      projectId: "11111111-1111-4111-8111-111111111111",
      projectName: "Checkout",
      dsn: "https://public@api.volato.dev/11111111-1111-4111-8111-111111111111",
      ingestToken: "server-only-token",
    });
    expect(getJson).toHaveBeenCalledWith(
      "/v1/projects/11111111-1111-4111-8111-111111111111/setup",
    );
  });

  it("preserves the API failure class without exposing credentials", async () => {
    getJson.mockResolvedValue({
      ok: false,
      status: 404,
      error: "project_not_found",
    });

    const error = await fetchProjectSetup(
      "22222222-2222-4222-8222-222222222222",
    ).catch((caught: unknown) => caught);

    expect(error).toMatchObject({
      message: "project_not_found",
      exitCode: EXIT.NOT_FOUND,
    });
  });
});
