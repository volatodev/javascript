import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const postJson = vi.fn();

vi.mock("../lib/api-client.js", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("../lib/api-client.js")>();
  return {
    ...original,
    postJson: (path: string, body: unknown) => postJson(path, body),
  };
});

const { runSkillUsage } = await import("../commands/skills.js");

beforeEach(() => {
  postJson.mockReset().mockResolvedValue({
    ok: true,
    status: 200,
    markdown: "recorded",
    data: { tracked: true },
  });
  vi.spyOn(process.stdout, "write").mockImplementation(() => true);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("runSkillUsage", () => {
  it("maps the installed Next.js skill to the stable backend branch", async () => {
    await runSkillUsage({
      skill: "volato-nextjs",
      stage: "outcome",
      runId: "repo-1.run-7",
    });

    expect(postJson).toHaveBeenCalledWith(
      "/v1/skills/errors-nextjs/usage",
      { stage: "outcome", runId: "repo-1.run-7" },
    );
  });

  it("preserves the other finite catalog branches", async () => {
    await runSkillUsage({
      skill: "landing-page",
      stage: "started",
      runId: "landing-42",
    });

    expect(postJson).toHaveBeenCalledWith(
      "/v1/skills/landing-page/usage",
      { stage: "started", runId: "landing-42" },
    );
  });

  it("rejects custom skills, stages and unsafe run ids locally", async () => {
    await expect(
      runSkillUsage({
        skill: "founder-custom-skill",
        stage: "started",
        runId: "run-1",
      }),
    ).rejects.toThrow(/unknown catalog skill/i);
    await expect(
      runSkillUsage({
        skill: "detect-pmf",
        stage: "finished",
        runId: "run-1",
      }),
    ).rejects.toThrow(/started or outcome/i);
    await expect(
      runSkillUsage({
        skill: "detect-pmf",
        stage: "started",
        runId: "contains spaces",
      }),
    ).rejects.toThrow(/run id/i);
    expect(postJson).not.toHaveBeenCalled();
  });
});
