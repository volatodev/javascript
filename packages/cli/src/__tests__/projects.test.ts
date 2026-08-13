import { beforeEach, describe, expect, it, vi } from "vitest";

const postJson = vi.fn();
const printSuccess = vi.fn();
const printApiError = vi.fn();
const listProjects = vi.fn();

vi.mock("../lib/api-client.js", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("../lib/api-client.js")>();
  return {
    ...original,
    postJson: (path: string, body: unknown) => postJson(path, body),
  };
});

vi.mock("../lib/output.js", () => ({
  printSuccess: (response: unknown, mode: unknown) =>
    printSuccess(response, mode),
  printApiError: (response: unknown) => printApiError(response),
}));

vi.mock("../lib/read-client.js", () => ({
  readApi: (operation: (client: unknown) => Promise<unknown>) =>
    operation({ listProjects }),
}));

const { normaliseProjectOrigins, runProjectOriginsSet, runProjectsList } =
  await import("../commands/projects.js");

const projectId = "11111111-1111-4111-8111-111111111111";

beforeEach(() => {
  postJson.mockReset();
  printSuccess.mockReset();
  printApiError.mockReset();
  listProjects.mockReset().mockResolvedValue({
    ok: true,
    status: 200,
    markdown: "No active projects.",
    data: { kind: "ok", projects: [], nextCursor: null },
  });
});

describe("runProjectsList", () => {
  it("forwards pagination to the typed read client", async () => {
    await runProjectsList({ limit: 10, cursor: "20", json: true });

    expect(listProjects).toHaveBeenCalledWith({ limit: 10, cursor: "20" });
    expect(printSuccess).toHaveBeenCalledWith(expect.anything(), "json");
  });
});

describe("normaliseProjectOrigins", () => {
  it("normalises URLs and removes duplicates before the API call", () => {
    expect(
      normaliseProjectOrigins([
        "https://App.Example.com/path",
        "https://app.example.com/other",
        "http://localhost:3000/login",
      ]),
    ).toEqual([
      "https://app.example.com",
      "http://localhost:3000",
    ]);
  });

  it.each(["app.example.com", "ftp://app.example.com", " "])(
    "rejects %j locally",
    (origin) => {
      expect(() => normaliseProjectOrigins([origin])).toThrow(
        "Use a full http:// or https:// origin",
      );
    },
  );
});

describe("runProjectOriginsSet", () => {
  it("replaces the project allowlist and prints the API result", async () => {
    const response = {
      ok: true,
      status: 200,
      markdown: "Allowed browser origins updated.",
      data: {
        projectId,
        origins: ["https://app.example.com"],
      },
    };
    postJson.mockResolvedValue(response);

    await runProjectOriginsSet({
      projectId,
      origins: ["https://app.example.com/path"],
    });

    expect(postJson).toHaveBeenCalledWith(
      `/v1/projects/${projectId}/allowed-origins`,
      { origins: ["https://app.example.com"] },
    );
    expect(printSuccess).toHaveBeenCalledWith(response, "human");
  });

  it("clears the allowlist explicitly", async () => {
    const response = {
      ok: true,
      status: 200,
      markdown: "Allowed browser origins cleared.",
      data: { projectId, origins: [] },
    };
    postJson.mockResolvedValue(response);

    await runProjectOriginsSet({
      projectId,
      origins: [],
      clear: true,
      json: true,
    });

    expect(postJson).toHaveBeenCalledWith(
      `/v1/projects/${projectId}/allowed-origins`,
      { origins: [] },
    );
    expect(printSuccess).toHaveBeenCalledWith(response, "json");
  });

  it("requires either one origin or the explicit clear flag", async () => {
    await expect(
      runProjectOriginsSet({ projectId, origins: [] }),
    ).rejects.toThrow("Pass at least one origin, or use --clear");
    expect(postJson).not.toHaveBeenCalled();
  });

  it("rejects origins combined with --clear", async () => {
    await expect(
      runProjectOriginsSet({
        projectId,
        origins: ["https://app.example.com"],
        clear: true,
      }),
    ).rejects.toThrow("Do not pass origins together with --clear");
    expect(postJson).not.toHaveBeenCalled();
  });
});
