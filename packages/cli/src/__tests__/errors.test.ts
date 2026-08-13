import { beforeEach, describe, expect, it, vi } from "vitest";

const postJson = vi.fn();
const printSuccess = vi.fn();
const searchErrorGroups = vi.fn();
const getErrorContext = vi.fn();
const getErrorSamples = vi.fn();

vi.mock("../lib/api-client.js", () => ({
  CliError: class CliError extends Error {},
  postJson: (path: string, body: unknown) => postJson(path, body),
}));

vi.mock("../lib/read-client.js", () => ({
  readApi: (operation: (client: unknown) => Promise<unknown>) =>
    operation({ searchErrorGroups, getErrorContext, getErrorSamples }),
}));

vi.mock("../lib/output.js", () => ({
  printSuccess: (response: unknown, mode: unknown) =>
    printSuccess(response, mode),
  printApiError: vi.fn(),
}));

const { runErrorSamples, runErrorsList, runErrorsResolve, runErrorsShow } =
  await import("../commands/errors.js");

beforeEach(() => {
  const response = {
    ok: true,
    status: 200,
    markdown: "No error groups found.",
    data: null,
  };
  searchErrorGroups.mockReset().mockResolvedValue(response);
  getErrorContext.mockReset().mockResolvedValue(response);
  getErrorSamples.mockReset().mockResolvedValue(response);
  printSuccess.mockReset();
  postJson.mockReset().mockResolvedValue({
    ok: true,
    status: 200,
    markdown: "Error group resolved.",
    data: { status: "resolved" },
  });
});

describe("errors status mutations", () => {
  it.each([undefined, "", "   "])(
    "refuses a mutation without a factual note (%s)",
    async (note) => {
      await expect(
        runErrorsResolve({ id: "group-1", action: "resolved", note }),
      ).rejects.toThrow(/note is required/i);
      expect(postJson).not.toHaveBeenCalled();
    },
  );

  it("sends the trimmed note as an explicit mutation", async () => {
    await runErrorsResolve({
      id: "group-1",
      action: "reopened",
      note: "  still failing after release abc123  ",
      json: true,
    });

    expect(postJson).toHaveBeenCalledWith("/v1/errors/group-1/resolve", {
      action: "reopened",
      note: "still failing after release abc123",
    });
    expect(printSuccess).toHaveBeenCalledWith(expect.anything(), "json");
  });
});

describe("errors environment scope", () => {
  it("queries production by default", async () => {
    await runErrorsList({});
    await runErrorsShow({});

    expect(searchErrorGroups).toHaveBeenCalledWith(
      expect.objectContaining({ environment: "production" }),
    );
    expect(getErrorContext).toHaveBeenCalledWith(
      expect.objectContaining({ environment: "production" }),
    );
  });

  it("forwards an explicit development scope", async () => {
    await runErrorsList({ environment: "development" });
    await runErrorsShow({ environment: "development" });

    expect(searchErrorGroups).toHaveBeenCalledWith(
      expect.objectContaining({ environment: "development" }),
    );
    expect(getErrorContext).toHaveBeenCalledWith(
      expect.objectContaining({ environment: "development" }),
    );
  });

  it("forwards bounded search and ranking filters", async () => {
    await runErrorsList({
      status: "all",
      release: "head",
      baselineRelease: "base",
      runtime: "node",
      route: "/checkout",
      fingerprint: "abc",
      firstSeenAfter: "2026-08-01T00:00:00.000Z",
      firstSeenBefore: "2026-08-10T00:00:00.000Z",
      lastSeenAfter: "2026-08-02T00:00:00.000Z",
      lastSeenBefore: "2026-08-09T00:00:00.000Z",
      minEvents: 3,
      minUsers: 2,
      sort: "growth",
      projectId: "project-1",
      limit: 10,
      cursor: "20",
      json: true,
    });

    expect(searchErrorGroups).toHaveBeenCalledWith({
      status: "all",
      release: "head",
      baselineRelease: "base",
      environment: "production",
      runtime: "node",
      route: "/checkout",
      fingerprint: "abc",
      firstSeenAfter: "2026-08-01T00:00:00.000Z",
      firstSeenBefore: "2026-08-10T00:00:00.000Z",
      lastSeenAfter: "2026-08-02T00:00:00.000Z",
      lastSeenBefore: "2026-08-09T00:00:00.000Z",
      minEvents: 3,
      minUsers: 2,
      sort: "growth",
      query: undefined,
      projectId: "project-1",
      limit: 10,
      cursor: "20",
    });
    expect(printSuccess).toHaveBeenCalledWith(expect.anything(), "json");
  });

  it("requests bounded, filtered event samples for one group", async () => {
    await runErrorSamples({
      id: "group/id",
      projectId: "project-1",
      environment: "staging",
      release: "head",
      runtime: "browser",
      route: "/checkout",
      strategy: "variations",
      limit: 3,
      json: true,
    });

    expect(getErrorSamples).toHaveBeenCalledWith({
      id: "group/id",
      projectId: "project-1",
      environment: "staging",
      release: "head",
      runtime: "browser",
      route: "/checkout",
      strategy: "variations",
      limit: 3,
    });
    expect(printSuccess).toHaveBeenCalledWith(expect.anything(), "json");
  });
});
