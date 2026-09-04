import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const promptsMock = vi.fn();
const postJsonMock = vi.fn();
const printApiErrorMock = vi.fn();
const printSuccessMock = vi.fn();

vi.mock("prompts", () => ({
  default: (options: unknown) => promptsMock(options),
}));

vi.mock("../lib/api-client.js", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("../lib/api-client.js")>();
  return {
    ...original,
    postJson: (path: string, body: unknown) => postJsonMock(path, body),
  };
});

vi.mock("../lib/output.js", () => ({
  printApiError: (response: unknown) => printApiErrorMock(response),
  printLocalError: vi.fn(),
  printSuccess: (response: unknown, mode: unknown) =>
    printSuccessMock(response, mode),
}));

const { runFeedback } = await import("../commands/feedback.js");

const originalStdinTty = Object.getOwnPropertyDescriptor(
  process.stdin,
  "isTTY",
);
const originalStdoutTty = Object.getOwnPropertyDescriptor(
  process.stdout,
  "isTTY",
);

function setTty(stream: NodeJS.ReadStream | NodeJS.WriteStream, value: boolean) {
  Object.defineProperty(stream, "isTTY", { configurable: true, value });
}

function restoreTty(
  stream: NodeJS.ReadStream | NodeJS.WriteStream,
  descriptor: PropertyDescriptor | undefined,
) {
  if (descriptor) Object.defineProperty(stream, "isTTY", descriptor);
  else delete (stream as NodeJS.ReadStream & { isTTY?: boolean }).isTTY;
}

beforeEach(() => {
  promptsMock.mockReset();
  postJsonMock.mockReset().mockResolvedValue({
    ok: true,
    status: 200,
    markdown: "Feedback sent.",
    data: { accepted: true },
  });
  printApiErrorMock.mockReset();
  printSuccessMock.mockReset();
  process.exitCode = undefined;
});

afterEach(() => {
  restoreTty(process.stdin, originalStdinTty);
  restoreTty(process.stdout, originalStdoutTty);
  process.exitCode = undefined;
  vi.restoreAllMocks();
});

describe("runFeedback", () => {
  it("requires explicit human approval in an agent shell", async () => {
    setTty(process.stdin, false);
    setTty(process.stdout, false);

    await expect(
      runFeedback({ message: "Please improve login recovery." }),
    ).rejects.toThrow("human explicitly approves this exact message");
    expect(postJsonMock).not.toHaveBeenCalled();
  });

  it("sends only the exact approved message", async () => {
    setTty(process.stdin, false);
    setTty(process.stdout, false);

    await runFeedback({
      message: "  Please improve login recovery.  ",
      yes: true,
    });

    expect(postJsonMock).toHaveBeenCalledWith("/v1/feedback", {
      message: "Please improve login recovery.",
    });
    expect(printSuccessMock).toHaveBeenCalledWith(expect.anything(), "human");
  });

  it("asks an interactive human before sending", async () => {
    setTty(process.stdin, true);
    setTty(process.stdout, true);
    promptsMock.mockResolvedValue({ approved: true });
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    await runFeedback({ message: "Please improve login recovery." });

    expect(promptsMock).toHaveBeenCalledWith(
      expect.objectContaining({ type: "confirm", initial: false }),
    );
    expect(postJsonMock).toHaveBeenCalledTimes(1);
  });

  it("refuses messages outside the API bounds", async () => {
    await expect(runFeedback({ message: "no", yes: true })).rejects.toThrow(
      "between 5 and 4000 characters",
    );
    await expect(
      runFeedback({ message: "x".repeat(4001), yes: true }),
    ).rejects.toThrow("between 5 and 4000 characters");
    expect(postJsonMock).not.toHaveBeenCalled();
  });
});
