import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fetchProjectSetup = vi.fn();
const reportIntegrationInstalled = vi.fn(async () => undefined);
const markProjectLinked = vi.fn();
const runSkillsInstall = vi.fn();

vi.mock("../commands/init/project-setup.js", () => ({
  fetchProjectSetup: (projectId: string) => fetchProjectSetup(projectId),
  markProjectLinked: (projectId: string) => markProjectLinked(projectId),
}));
vi.mock("../commands/skills.js", () => ({
  runSkillsInstall: (options: unknown) => runSkillsInstall(options),
}));

const { runInit } = await import("../commands/init/init.js");

let cwd: string;

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), "volato-bootstrap-"));
  fetchProjectSetup.mockReset();
  fetchProjectSetup.mockResolvedValue({
    projectId: "11111111-1111-4111-8111-111111111111",
    projectName: "Checkout",
    dsn: "https://public@api.volato.dev/11111111-1111-4111-8111-111111111111",
    ingestToken: "server-only-token",
  });
  markProjectLinked.mockReset();
  markProjectLinked.mockResolvedValue({ linked: true });
  runSkillsInstall.mockReset();
  vi.spyOn(process.stdout, "write").mockImplementation(() => true);
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(cwd, { recursive: true, force: true });
});

describe("volato init --project", () => {
  it("links the repository without detecting a framework or writing credentials", async () => {
    await runInit({
      cwd,
      projectId: "11111111-1111-4111-8111-111111111111",
      nonInteractive: true,
    });

    expect(fetchProjectSetup).toHaveBeenCalledWith(
      "11111111-1111-4111-8111-111111111111",
    );
    expect(runSkillsInstall).toHaveBeenCalledWith({
      cwd,
      nonInteractive: true,
    });
    expect(markProjectLinked).toHaveBeenCalledWith(
      "11111111-1111-4111-8111-111111111111",
    );
    expect(existsSync(join(cwd, ".env.local"))).toBe(false);
    expect(
      JSON.parse(readFileSync(join(cwd, ".volato", "manifest.json"), "utf8")),
    ).toEqual({
      schemaVersion: 2,
      project: {
        id: "11111111-1111-4111-8111-111111111111",
        name: "Checkout",
      },
      integrations: {},
    });
  });

  it("requires a project id in non-interactive mode", async () => {
    await expect(
      runInit({ cwd, nonInteractive: true }),
    ).rejects.toThrow(/--project/);
    expect(fetchProjectSetup).not.toHaveBeenCalled();
  });
});
