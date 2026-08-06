import { beforeEach, describe, expect, it, vi } from "vitest";

const getJson = vi.fn();
const printSuccess = vi.fn();

vi.mock("../lib/api-client.js", () => ({
  getJson: (path: string, query: unknown) => getJson(path, query),
  postJson: vi.fn(),
}));

vi.mock("../lib/output.js", () => ({
  printSuccess: (response: unknown, mode: unknown) =>
    printSuccess(response, mode),
  printApiError: vi.fn(),
}));

const { runErrorsList, runErrorsShow } = await import("../commands/errors.js");

beforeEach(() => {
  getJson.mockReset().mockResolvedValue({
    ok: true,
    status: 200,
    markdown: "No error groups found.",
    data: null,
  });
  printSuccess.mockReset();
});

describe("errors environment scope", () => {
  it("queries production by default", async () => {
    await runErrorsList({});
    await runErrorsShow({});

    expect(getJson).toHaveBeenNthCalledWith(
      1,
      "/v1/errors",
      expect.objectContaining({ environment: "production" }),
    );
    expect(getJson).toHaveBeenNthCalledWith(
      2,
      "/v1/errors/context",
      expect.objectContaining({ environment: "production" }),
    );
  });

  it("forwards an explicit development scope", async () => {
    await runErrorsList({ environment: "development" });
    await runErrorsShow({ environment: "development" });

    expect(getJson).toHaveBeenNthCalledWith(
      1,
      "/v1/errors",
      expect.objectContaining({ environment: "development" }),
    );
    expect(getJson).toHaveBeenNthCalledWith(
      2,
      "/v1/errors/context",
      expect.objectContaining({ environment: "development" }),
    );
  });
});
