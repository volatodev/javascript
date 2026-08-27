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
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { detectErrorsStack } from "../commands/init/detect-errors";
import { generateNestIntegration } from "../integrations/nest";
import {
  ERRORS_NODE_FASTIFY_INTEGRATION,
  ERRORS_NODE_NESTJS_INTEGRATION,
  linkProject,
  modifiedGeneratedFiles,
  readManifest,
} from "../integrations/manifest";

let cwd: string;

function writeNestFixture(transport: "express" | "fastify", version: 11 | 12): void {
  const adapterImport =
    transport === "fastify"
      ? 'import { FastifyAdapter } from "@nestjs/platform-fastify";\n'
      : "";
  const adapterArgument =
    transport === "fastify" ? ", new FastifyAdapter()" : "";
  writeFileSync(
    join(cwd, "package.json"),
    `${JSON.stringify({
      name: "nest-fixture",
      type: "commonjs",
      scripts: { build: "nest build" },
      dependencies: {
        "@nestjs/common": version === 11 ? "11.2.3" : "12.0.1",
        "@nestjs/core": version === 11 ? "11.2.3" : "12.0.1",
        [transport === "fastify"
          ? "@nestjs/platform-fastify"
          : "@nestjs/platform-express"]: version === 11 ? "11.2.3" : "12.0.1",
        [transport === "fastify" ? "fastify" : "express"]: "5.12.1",
      },
    }, null, 2)}\n`,
  );
  writeFileSync(
    join(cwd, "tsconfig.json"),
    `${JSON.stringify({
      compilerOptions: {
        module: "commonjs",
        outDir: "dist",
        sourceMap: true,
        inlineSources: false,
        experimentalDecorators: true,
      },
    }, null, 2)}\n`,
  );
  writeFileSync(
    join(cwd, "src", "main.ts"),
    `import { NestFactory } from "@nestjs/core";
${adapterImport}import { AppModule } from "./app.module";
async function bootstrap() {
  const app = await NestFactory.create(AppModule${adapterArgument});
  await app.listen(3000);
}
void bootstrap();
`,
  );
}

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), "volato-nest-"));
  mkdirSync(join(cwd, "src"));
  writeNestFixture("express", 11);
  linkProject(cwd, {
    id: "11111111-1111-4111-8111-111111111111",
    name: "Nest fixture",
  });
});

afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
});

describe("NestJS generated integration", () => {
  it.each([
    ["NestJS 11 + Express", "express", 11],
    ["NestJS 12 + Fastify", "fastify", 12],
  ] as const)("composes one delegated catch-all filter for %s", (_label, transport, version) => {
    writeNestFixture(transport, version);
    const project = detectErrorsStack(cwd).nest!;
    const result = generateNestIntegration({
      cwd,
      project,
      dsn: "https://public@api.volato.dev/project",
    });

    const entry = readFileSync(project.entryPath, "utf8");
    expect(entry).toContain("initVolatoNode()");
    expect(entry).toContain('import { HttpAdapterHost } from "@nestjs/core";');
    expect(entry).toContain("const { httpAdapter } = app.get(HttpAdapterHost)");
    expect(entry).toContain(
      "app.useGlobalFilters(new VolatoHttpExceptionFilter(httpAdapter))",
    );
    expect(entry.indexOf("NestFactory.create")).toBeLessThan(
      entry.indexOf("app.useGlobalFilters"),
    );
    expect(entry.indexOf("app.useGlobalFilters")).toBeLessThan(
      entry.indexOf("app.listen"),
    );
    expect(entry).not.toContain("volatoFastifyErrorHook");
    expect(entry).not.toContain("volatoExpressErrorHandler");
    for (const file of ["node.ts", "nestjs.ts", "upload-sourcemaps.mjs"]) {
      expect(existsSync(join(cwd, "src", "volato-node", file))).toBe(true);
    }
    const integration = readManifest(cwd)?.integrations[
      ERRORS_NODE_NESTJS_INTEGRATION
    ];
    expect(integration?.recipe).toBe(`errors-node-nestjs-${transport}`);
    expect(modifiedGeneratedFiles(cwd, integration!)).toEqual([]);
    expect(result.outcomes.every((outcome) => outcome.status !== "manual")).toBe(
      true,
    );
  });

  it("is convergent and never adds a transport-level adapter", () => {
    generateNestIntegration({
      cwd,
      project: detectErrorsStack(cwd).nest!,
      dsn: "https://public@api.volato.dev/project",
    });

    const second = generateNestIntegration({
      cwd,
      project: detectErrorsStack(cwd).nest!,
      dsn: "https://public@api.volato.dev/project",
    });
    expect(second.outcomes.every((outcome) => outcome.status === "skipped")).toBe(
      true,
    );
    expect(readManifest(cwd)?.integrations[ERRORS_NODE_FASTIFY_INTEGRATION]).toBeUndefined();
  });
});
