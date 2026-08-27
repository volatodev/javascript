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
import { generateNodeInvocationIntegration } from "../integrations/node-invocation";
import {
  ERRORS_NODE_INVOCATION_INTEGRATION,
  linkProject,
  modifiedGeneratedFiles,
  readManifest,
} from "../integrations/manifest";

let cwd: string;

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), "volato-invocation-"));
  mkdirSync(join(cwd, "src"));
  linkProject(cwd, {
    id: "11111111-1111-4111-8111-111111111111",
    name: "Fixture",
  });
});

afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
});

describe("Node invocation generated integration", () => {
  it("wraps an ESM TypeScript handler and composes its sourcemap upload", () => {
    writeFileSync(
      join(cwd, "package.json"),
      `${JSON.stringify({
        name: "fixture",
        type: "module",
        scripts: { build: "tsc --sourceMap" },
      }, null, 2)}\n`,
    );
    writeFileSync(
      join(cwd, "tsconfig.json"),
      `${JSON.stringify({ compilerOptions: { outDir: "dist" } }, null, 2)}\n`,
    );
    const handlerPath = join(cwd, "src", "handler.ts");
    writeFileSync(
      handlerPath,
      "export const handler = async (input: unknown) => ({ input });\n",
    );

    const result = generateNodeInvocationIntegration({
      cwd,
      dsn: "https://pk@api.volato.dev/project",
      ingestToken: "server-only-token",
      project: detectErrorsStack(cwd).nodeInvocation!,
    });

    expect(readFileSync(handlerPath, "utf8")).toContain(
      'import { withVolatoInvocation } from "./volato-invocation/invocation.js";',
    );
    expect(readFileSync(handlerPath, "utf8")).toContain(
      "const volatoOriginalHandler = async",
    );
    expect(readFileSync(handlerPath, "utf8")).toContain(
      'export const handler = withVolatoInvocation(volatoOriginalHandler, { functionName: "handler" });',
    );
    for (const path of ["node.ts", "invocation.ts", "upload-sourcemaps.mjs"]) {
      expect(existsSync(join(cwd, "src", "volato-invocation", path))).toBe(true);
    }
    expect(
      JSON.parse(readFileSync(join(cwd, "package.json"), "utf8")).scripts.build,
    ).toContain("upload-sourcemaps.mjs dist");
    const integration = readManifest(cwd)?.integrations[
      ERRORS_NODE_INVOCATION_INTEGRATION
    ];
    expect(integration?.recipe).toBe("errors-node-invocation");
    expect(modifiedGeneratedFiles(cwd, integration!)).toEqual([]);
    expect(result.outcomes.every((outcome) => outcome.status !== "manual")).toBe(
      true,
    );
  });

  it("wraps a direct CommonJS Node HTTP handler without a build", () => {
    writeFileSync(
      join(cwd, "package.json"),
      `${JSON.stringify({ name: "fixture", type: "commonjs" }, null, 2)}\n`,
    );
    const handlerPath = join(cwd, "src", "handler.js");
    writeFileSync(
      handlerPath,
      'exports.handler = async (req, res) => { res.statusCode = 204; res.end(); };\n',
    );

    const project = detectErrorsStack(cwd).nodeInvocation!;
    const first = generateNodeInvocationIntegration({
      cwd,
      dsn: "https://pk@api.volato.dev/project",
      project,
    });
    const second = generateNodeInvocationIntegration({
      cwd,
      dsn: "https://pk@api.volato.dev/project",
      project: detectErrorsStack(cwd).nodeInvocation!,
    });

    const handler = readFileSync(handlerPath, "utf8");
    expect(handler).toContain(
      'const { withVolatoInvocation } = require("./volato-invocation/invocation.cjs");',
    );
    expect(handler).toContain(
      'exports.handler = withVolatoInvocation(volatoOriginalHandler, { functionName: "handler", http: true });',
    );
    expect(handler.match(/withVolatoInvocation\(/g)).toHaveLength(1);
    expect(existsSync(join(cwd, "src", "volato-invocation", "node.cjs"))).toBe(
      true,
    );
    expect(
      existsSync(join(cwd, "src", "volato-invocation", "invocation.cjs")),
    ).toBe(true);
    expect(first.outcomes.every((outcome) => outcome.status !== "manual")).toBe(
      true,
    );
    expect(second.outcomes).toContainEqual(
      expect.objectContaining({
        path: handlerPath,
        status: "skipped",
        detail: expect.stringMatching(/already wrapped/i),
      }),
    );
  });
});
