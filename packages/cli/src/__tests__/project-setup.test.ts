import { beforeEach, describe, expect, it, vi } from "vitest";
import { EXIT } from "../lib/exit.js";

const getJson = vi.fn();
const postJson = vi.fn();

vi.mock("../lib/api-client.js", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("../lib/api-client.js")>();
  return {
    ...original,
    getJson: (path: string) => getJson(path),
    postJson: (path: string, body: unknown) => postJson(path, body),
  };
});

const { fetchProjectSetup, markProjectLinked } = await import(
  "../commands/init/project-setup.js"
);

beforeEach(() => {
  getJson.mockReset();
  postJson.mockReset();
});

describe("markProjectLinked", () => {
  it("confirms the authoritative transition after local setup succeeds", async () => {
    const projectId = "11111111-1111-4111-8111-111111111111";
    postJson.mockResolvedValue({
      ok: true,
      status: 200,
      data: { projectId, linked: true },
    });

    await expect(markProjectLinked(projectId)).resolves.toEqual({
      linked: true,
    });
    expect(postJson).toHaveBeenCalledWith(
      `/v1/projects/${projectId}/linked`,
      {},
    );
  });

  it("surfaces an invalid confirmation instead of inventing a milestone", async () => {
    const projectId = "11111111-1111-4111-8111-111111111111";
    postJson.mockResolvedValue({
      ok: true,
      status: 200,
      data: { projectId, linked: false },
    });

    await expect(markProjectLinked(projectId)).rejects.toThrow(
      "invalid project link response",
    );
  });
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
