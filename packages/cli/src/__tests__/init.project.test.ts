import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const fetchProjectSetup = vi.fn();
const generateNextjsIntegration = vi.fn();
const runSkillsInstall = vi.fn();

vi.mock("../commands/init/project-setup.js", () => ({
  fetchProjectSetup: (projectId: string) => fetchProjectSetup(projectId),
}));
vi.mock("../integrations/nextjs.js", () => ({
  generateNextjsIntegration: (options: unknown) =>
    generateNextjsIntegration(options),
}));
vi.mock("../commands/skills.js", () => ({
  runSkillsInstall: (options: unknown) => runSkillsInstall(options),
}));

const { runInit } = await import("../commands/init/init.js");

let cwd: string;

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), "volato-init-project-"));
  mkdirSync(join(cwd, "app"), { recursive: true });
  writeFileSync(
    join(cwd, "package.json"),
    JSON.stringify({
      name: "fixture",
      dependencies: { next: "15.5.21", react: "19.0.0" },
    }),
  );
  writeFileSync(
    join(cwd, "app", "layout.tsx"),
    "export default function Layout({ children }) { return <html><body>{children}</body></html>; }\n",
  );
  writeFileSync(join(cwd, "next.config.ts"), "export default {};\n");

  fetchProjectSetup.mockReset();
  fetchProjectSetup.mockResolvedValue({
    projectId: "11111111-1111-4111-8111-111111111111",
    projectName: "Checkout",
    dsn: "https://public@api.volato.dev/11111111-1111-4111-8111-111111111111",
    ingestToken: "server-only-token",
  });
  runSkillsInstall.mockReset();
  generateNextjsIntegration.mockReset();
  generateNextjsIntegration.mockImplementation(() => {
    expect(existsSync(join(cwd, ".gitignore"))).toBe(true);
    expect(readFileSync(join(cwd, ".gitignore"), "utf8")).toContain(
      ".env*.local",
    );
    return {
      runtimeRoot: join(cwd, "volato"),
      generatedFiles: [join(cwd, "volato", "client.tsx")],
      manifestPath: join(cwd, ".volato", "manifest.json"),
      outcomes: [],
    };
  });
  vi.spyOn(process.stdout, "write").mockImplementation(() => true);
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(cwd, { recursive: true, force: true });
});

describe("volato init --project", () => {
  it("fetches credentials, protects local env, installs skills, and generates the integration", async () => {
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
      force: true,
    });
    expect(generateNextjsIntegration).toHaveBeenCalledWith(
      expect.objectContaining({
        cwd,
        dsn: "https://public@api.volato.dev/11111111-1111-4111-8111-111111111111",
        ingestToken: "server-only-token",
      }),
    );
  });

  it("does not create a nested .gitignore when the monorepo root covers local env files", async () => {
    const appCwd = join(cwd, "apps", "web");
    mkdirSync(join(cwd, ".git"));
    mkdirSync(join(appCwd, "app"), { recursive: true });
    writeFileSync(join(cwd, ".gitignore"), ".env*.local\n");
    writeFileSync(
      join(appCwd, "package.json"),
      JSON.stringify({
        name: "web",
        dependencies: { next: "15.5.21", react: "19.0.0" },
      }),
    );
    writeFileSync(
      join(appCwd, "app", "layout.tsx"),
      "export default function Layout({ children }) { return <html><body>{children}</body></html>; }\n",
    );
    writeFileSync(join(appCwd, "next.config.ts"), "export default {};\n");
    generateNextjsIntegration.mockReturnValueOnce({
      runtimeRoot: join(appCwd, "volato"),
      generatedFiles: [join(appCwd, "volato", "client.tsx")],
      manifestPath: join(appCwd, ".volato", "manifest.json"),
      outcomes: [],
    });

    await runInit({
      cwd: appCwd,
      projectId: "11111111-1111-4111-8111-111111111111",
      nonInteractive: true,
    });

    expect(existsSync(join(appCwd, ".gitignore"))).toBe(false);
    expect(readFileSync(join(cwd, ".gitignore"), "utf8")).toBe(
      ".env*.local\n",
    );
  });
});
