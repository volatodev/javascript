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
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { linkProject } from "../integrations/manifest";

const fetchProjectSetup = vi.fn();
const reportIntegrationInstalled = vi.fn(async () => undefined);
const generateNextjsIntegration = vi.fn();

vi.mock("../commands/init/project-setup.js", () => ({
  fetchProjectSetup: (projectId: string) => fetchProjectSetup(projectId),
  reportIntegrationInstalled: reportIntegrationInstalled,
}));
vi.mock("../integrations/nextjs.js", () => ({
  generateNextjsIntegration: (options: unknown) =>
    generateNextjsIntegration(options),
}));

const { runErrorsInit } = await import("../commands/init/errors.js");

let cwd: string;

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), "volato-errors-init-"));
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
  linkProject(cwd, {
    id: "11111111-1111-4111-8111-111111111111",
    name: "Checkout",
  });

  fetchProjectSetup.mockReset();
  fetchProjectSetup.mockResolvedValue({
    projectId: "11111111-1111-4111-8111-111111111111",
    projectName: "Checkout",
    dsn: "https://public@api.volato.dev/11111111-1111-4111-8111-111111111111",
    ingestToken: "server-only-token",
  });
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

describe("volato errors init", () => {
  it("loads the linked project, protects credentials, and invokes the Errors adapter", async () => {
    await runErrorsInit({ cwd, nonInteractive: true });

    expect(fetchProjectSetup).toHaveBeenCalledWith(
      "11111111-1111-4111-8111-111111111111",
    );
    // The journey cannot show "installed capture" unless init reports it:
    // /setup fires on plain `volato init` too, long before anything exists.
    expect(reportIntegrationInstalled).toHaveBeenCalledWith(
      "11111111-1111-4111-8111-111111111111",
      "errors-nextjs",
    );
    expect(generateNextjsIntegration).toHaveBeenCalledWith(
      expect.objectContaining({
        cwd,
        dsn: "https://public@api.volato.dev/11111111-1111-4111-8111-111111111111",
        ingestToken: "server-only-token",
      }),
    );
    const output = vi.mocked(process.stdout.write).mock.calls.join("\n");
    expect(output).toContain("Volato Errors files are composed.");
    expect(output).toContain(
      "Run the production build and applicable capture checks before deployment.",
    );
    expect(output).not.toContain("Volato Errors is ready.");
    expect(output).not.toContain("Fix the latest production error.");
  });

  it("prints the Node-runtime composition for a Next.js 16 proxy", async () => {
    writeFileSync(
      join(cwd, "package.json"),
      JSON.stringify({
        name: "fixture",
        dependencies: { next: "16.2.12", react: "19.2.8" },
      }),
    );
    writeFileSync(join(cwd, "proxy.ts"), "export function proxy() {}\n");

    await runErrorsInit({ cwd, nonInteractive: true });

    const output = vi.mocked(process.stdout.write).mock.calls.join("\n");
    expect(output).toContain("Wrap your proxy (proxy.ts)");
    expect(output).toContain("wrapProxy");
    expect(output).toContain('from "./volato/server"');
    expect(output).not.toContain("wrapMiddleware");
  });

  it("does not report readiness while a runtime boundary needs manual composition", async () => {
    generateNextjsIntegration.mockReturnValue({
      runtimeRoot: join(cwd, "volato"),
      generatedFiles: [join(cwd, "volato", "client.tsx")],
      manifestPath: join(cwd, ".volato", "manifest.json"),
      outcomes: [
        {
          path: join(cwd, "middleware.ts"),
          status: "manual",
          detail: "existing runtime boundary must be composed with wrapMiddleware",
        },
      ],
    });

    await expect(
      runErrorsInit({ cwd, nonInteractive: true }),
    ).rejects.toThrow(/setup is incomplete/i);

    const output = vi.mocked(process.stdout.write).mock.calls.join("\n");
    expect(output).toContain("Setup incomplete");
    expect(output).not.toContain("Volato Errors files are composed");
    expect(reportIntegrationInstalled).not.toHaveBeenCalled();
  });

  it("finishes supported Vite capture while announcing an unsupported Python backend", async () => {
    rmSync(join(cwd, "app"), { recursive: true, force: true });
    rmSync(join(cwd, "next.config.ts"), { force: true });
    writeFileSync(
      join(cwd, "package.json"),
      JSON.stringify({
        name: "fixture",
        scripts: { build: "vite build" },
        dependencies: {
          react: "19.1.1",
          "react-dom": "19.1.1",
          vite: "7.1.1",
        },
      }),
    );
    mkdirSync(join(cwd, "src"), { recursive: true });
    mkdirSync(join(cwd, "backend"), { recursive: true });
    writeFileSync(
      join(cwd, "src", "main.tsx"),
      'import { createRoot } from "react-dom/client";\nimport App from "./App";\ncreateRoot(document.getElementById("root")!).render(<App />);\n',
    );
    writeFileSync(
      join(cwd, "vite.config.ts"),
      'import { defineConfig } from "vite";\nexport default defineConfig({});\n',
    );
    writeFileSync(join(cwd, "backend", "pyproject.toml"), "[project]\n");

    await runErrorsInit({ cwd, nonInteractive: true });

    const output = vi.mocked(process.stdout.write).mock.calls.join("\n");
    expect(output).toMatch(
      /Python backend capture is not supported.*browser capture will be installed/i,
    );
    expect(output).toContain("Volato Errors files are composed.");
    expect(reportIntegrationInstalled).toHaveBeenCalledWith(
      "11111111-1111-4111-8111-111111111111",
      "errors-vite-react",
    );
    expect(generateNextjsIntegration).not.toHaveBeenCalled();
  });
});
