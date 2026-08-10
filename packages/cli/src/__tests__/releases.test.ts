import { beforeEach, describe, expect, it, vi } from "vitest";

const getJson = vi.fn();
const printSuccess = vi.fn();

vi.mock("../lib/api-client.js", () => ({
  getJson: (path: string, query: unknown) => getJson(path, query),
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
  getJson.mockReset().mockResolvedValue({
    ok: true,
    status: 200,
    markdown: "ok",
    data: {},
  });
  printSuccess.mockReset();
});

describe("release commands", () => {
  it("lists releases in production by default", async () => {
    await runReleasesList({ projectId: "project-1", runtime: "node" });

    expect(getJson).toHaveBeenCalledWith("/v1/releases", {
      projectId: "project-1",
      environment: "production",
      runtime: "node",
      limit: undefined,
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
      json: true,
    });

    expect(getJson).toHaveBeenCalledWith("/v1/releases/compare", {
      head: "head",
      base: "base",
      projectId: "project-1",
      environment: "staging",
      runtime: "browser",
      limit: 12,
    });
    expect(printSuccess).toHaveBeenCalledWith(expect.anything(), "json");
  });
});
