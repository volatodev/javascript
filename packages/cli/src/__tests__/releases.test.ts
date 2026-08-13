import { beforeEach, describe, expect, it, vi } from "vitest";

const printSuccess = vi.fn();
const listReleases = vi.fn();
const compareReleases = vi.fn();

vi.mock("../lib/read-client.js", () => ({
  readApi: (operation: (client: unknown) => Promise<unknown>) =>
    operation({ listReleases, compareReleases }),
}));

vi.mock("../lib/output.js", () => ({
  printSuccess: (response: unknown, mode: unknown) =>
    printSuccess(response, mode),
  printApiError: vi.fn(),
}));

const { runReleasesCompare, runReleasesList } = await import(
  "../commands/releases.js"
);

beforeEach(() => {
  const response = {
    ok: true,
    status: 200,
    markdown: "ok",
    data: {},
  };
  listReleases.mockReset().mockResolvedValue(response);
  compareReleases.mockReset().mockResolvedValue(response);
  printSuccess.mockReset();
});

describe("release commands", () => {
  it("lists releases in production by default", async () => {
    await runReleasesList({
      projectId: "project-1",
      runtime: "node",
      cursor: "20",
    });

    expect(listReleases).toHaveBeenCalledWith({
      projectId: "project-1",
      environment: "production",
      runtime: "node",
      limit: undefined,
      cursor: "20",
    });
    expect(printSuccess).toHaveBeenCalledWith(expect.anything(), "human");
  });

  it("compares an explicit head and base with structured output", async () => {
    await runReleasesCompare({
      head: "head",
      base: "base",
      projectId: "project-1",
      environment: "staging",
      runtime: "browser",
      limit: 12,
      cursor: "12",
      json: true,
    });

    expect(compareReleases).toHaveBeenCalledWith({
      head: "head",
      base: "base",
      projectId: "project-1",
      environment: "staging",
      runtime: "browser",
      limit: 12,
      cursor: "12",
    });
    expect(printSuccess).toHaveBeenCalledWith(expect.anything(), "json");
  });
});
