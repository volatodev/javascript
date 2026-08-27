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

  it("installs and reports a provider-neutral Node invocation", async () => {
    rmSync(join(cwd, "app"), { recursive: true, force: true });
    rmSync(join(cwd, "next.config.ts"), { force: true });
    writeFileSync(
      join(cwd, "package.json"),
      `${JSON.stringify({ name: "fixture", type: "module" }, null, 2)}\n`,
    );
    mkdirSync(join(cwd, "src"), { recursive: true });
    writeFileSync(
      join(cwd, "src", "handler.js"),
      "export const handler = async (input) => ({ input });\n",
    );

    await runErrorsInit({ cwd, nonInteractive: true });

    expect(reportIntegrationInstalled).toHaveBeenCalledWith(
      "11111111-1111-4111-8111-111111111111",
      "errors-node-invocation",
    );
    expect(readFileSync(join(cwd, "src", "handler.js"), "utf8")).toContain(
      "withVolatoInvocation",
    );
    const output = vi.mocked(process.stdout.write).mock.calls.join("\n");
    expect(output).toContain("Node invocation");
    expect(output).toContain("production build and applicable capture checks");
  });

  it("installs and reports a conventional Vite + Vue application", async () => {
    rmSync(join(cwd, "app"), { recursive: true, force: true });
    rmSync(join(cwd, "next.config.ts"), { force: true });
    writeFileSync(
      join(cwd, "package.json"),
      `${JSON.stringify({
        name: "vue-fixture",
        type: "module",
        dependencies: {
          vue: "3.5.42",
          vite: "7.3.6",
          "@vitejs/plugin-vue": "6.0.8",
        },
      })}\n`,
    );
    mkdirSync(join(cwd, "src"), { recursive: true });
    writeFileSync(
      join(cwd, "src", "main.ts"),
      'import { createApp } from "vue";\nconst app = createApp({});\napp.mount("#app");\n',
    );
    writeFileSync(
      join(cwd, "vite.config.ts"),
      'import { defineConfig } from "vite";\nexport default defineConfig({});\n',
    );

    await runErrorsInit({ cwd, nonInteractive: true });

    expect(reportIntegrationInstalled).toHaveBeenCalledWith(
      "11111111-1111-4111-8111-111111111111",
      "errors-browser-vue",
    );
    expect(readFileSync(join(cwd, "src", "main.ts"), "utf8")).toContain(
      "installVolatoVue(app)",
    );
    const output = vi.mocked(process.stdout.write).mock.calls.join("\n");
    expect(output).toContain("Vue render error");
  });

  it("installs and reports a conventional Vite + Svelte application", async () => {
    rmSync(join(cwd, "app"), { recursive: true, force: true });
    rmSync(join(cwd, "next.config.ts"), { force: true });
    writeFileSync(
      join(cwd, "package.json"),
      `${JSON.stringify({
        name: "svelte-fixture",
        type: "module",
        dependencies: {
          svelte: "5.56.10",
          vite: "8.2.2",
          "@sveltejs/vite-plugin-svelte": "7.3.0",
        },
      })}\n`,
    );
    mkdirSync(join(cwd, "src"), { recursive: true });
    writeFileSync(
      join(cwd, "src", "main.js"),
      'import { mount } from "svelte";\nimport App from "./App.svelte";\nconst app = mount(App, { target: document.body });\nexport default app;\n',
    );
    writeFileSync(join(cwd, "src", "App.svelte"), "<main>Ready</main>\n");
    writeFileSync(
      join(cwd, "vite.config.js"),
      'import { defineConfig } from "vite";\nexport default defineConfig({});\n',
    );

    await runErrorsInit({ cwd, nonInteractive: true });

    expect(reportIntegrationInstalled).toHaveBeenCalledWith(
      "11111111-1111-4111-8111-111111111111",
      "errors-browser-svelte",
    );
    expect(readFileSync(join(cwd, "src", "App.svelte"), "utf8")).toBe(
      "<main>Ready</main>\n",
    );
    expect(readFileSync(join(cwd, "src", "main.js"), "utf8")).toContain(
      "VolatoSvelteRoot.svelte",
    );
    expect(
      readFileSync(
        join(cwd, "src", "volato", "VolatoSvelteRoot.svelte"),
        "utf8",
      ),
    ).toContain("<svelte:boundary");
    const output = vi.mocked(process.stdout.write).mock.calls.join("\n");
    expect(output).toContain("Svelte render error");
  });

  it("installs and reports a conventional Fastify 5 server", async () => {
    rmSync(join(cwd, "app"), { recursive: true, force: true });
    rmSync(join(cwd, "next.config.ts"), { force: true });
    writeFileSync(
      join(cwd, "package.json"),
      `${JSON.stringify({
        name: "fastify-fixture",
        type: "module",
        dependencies: { fastify: "5.12.1" },
      })}\n`,
    );
    mkdirSync(join(cwd, "src"), { recursive: true });
    writeFileSync(
      join(cwd, "src", "server.js"),
      'import Fastify from "fastify";\nconst app = Fastify();\napp.listen({ port: 3000 });\n',
    );

    await runErrorsInit({ cwd, nonInteractive: true });

    expect(reportIntegrationInstalled).toHaveBeenCalledWith(
      "11111111-1111-4111-8111-111111111111",
      "errors-node-fastify",
    );
    expect(readFileSync(join(cwd, "src", "server.js"), "utf8")).toContain(
      'app.addHook("onError", volatoFastifyErrorHook())',
    );
    const output = vi.mocked(process.stdout.write).mock.calls.join("\n");
    expect(output).toContain("controlled Fastify error");
  });

  it("installs and reports a conventional NestJS HTTP application", async () => {
    rmSync(join(cwd, "app"), { recursive: true, force: true });
    rmSync(join(cwd, "next.config.ts"), { force: true });
    writeFileSync(
      join(cwd, "package.json"),
      `${JSON.stringify({
        name: "nest-fixture",
        type: "commonjs",
        scripts: { build: "nest build" },
        dependencies: {
          "@nestjs/common": "11.2.3",
          "@nestjs/core": "11.2.3",
          "@nestjs/platform-express": "11.2.3",
        },
      })}\n`,
    );
    mkdirSync(join(cwd, "src"), { recursive: true });
    writeFileSync(
      join(cwd, "tsconfig.json"),
      '{"compilerOptions":{"outDir":"dist","sourceMap":true}}\n',
    );
    writeFileSync(
      join(cwd, "src", "main.ts"),
      'import { NestFactory } from "@nestjs/core";\nasync function bootstrap() {\n  const app = await NestFactory.create(AppModule);\n  await app.listen(3000);\n}\nvoid bootstrap();\n',
    );

    await runErrorsInit({ cwd, nonInteractive: true });

    expect(reportIntegrationInstalled).toHaveBeenCalledWith(
      "11111111-1111-4111-8111-111111111111",
      "errors-node-nestjs",
    );
    expect(readFileSync(join(cwd, "src", "main.ts"), "utf8")).toContain(
      "VolatoHttpExceptionFilter",
    );
    const output = vi.mocked(process.stdout.write).mock.calls.join("\n");
    expect(output).toContain("controlled NestJS error");
  });
});
