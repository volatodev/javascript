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
import { generateFastifyIntegration } from "../integrations/fastify";
import {
  ERRORS_NODE_FASTIFY_INTEGRATION,
  linkProject,
  modifiedGeneratedFiles,
  readManifest,
} from "../integrations/manifest";

let cwd: string;

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), "volato-fastify-"));
  mkdirSync(join(cwd, "src"));
  writeFileSync(
    join(cwd, "package.json"),
    `${JSON.stringify({
      name: "fastify-fixture",
      type: "module",
      scripts: { build: "tsc --sourceMap" },
      dependencies: { fastify: "5.12.1" },
    }, null, 2)}\n`,
  );
  writeFileSync(
    join(cwd, "tsconfig.json"),
    `${JSON.stringify({ compilerOptions: { outDir: "dist" } }, null, 2)}\n`,
  );
  writeFileSync(
    join(cwd, "src", "server.ts"),
    `import Fastify from "fastify";
const app = Fastify();
app.get("/users/:userId", async () => { throw new Error("route failed"); });
app.setErrorHandler((error, _request, reply) => reply.status(418).send(error.message));
await app.listen({ port: 3000 });
`,
  );
  linkProject(cwd, {
    id: "11111111-1111-4111-8111-111111111111",
    name: "Fastify fixture",
  });
});

afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
});

describe("Fastify generated integration", () => {
  it("registers one root onError hook before application-owned handling", () => {
    const project = detectErrorsStack(cwd).fastify!;
    const result = generateFastifyIntegration({
      cwd,
      project,
      dsn: "https://public@api.volato.dev/project",
    });

    const entry = readFileSync(project.entryPath, "utf8");
    expect(entry).toContain("initVolatoNode()");
    expect(entry).toContain('app.addHook("onError", volatoFastifyErrorHook())');
    expect(entry.indexOf("const app = Fastify()")).toBeLessThan(
      entry.indexOf('app.addHook("onError"'),
    );
    expect(entry.indexOf('app.addHook("onError"')).toBeLessThan(
      entry.indexOf("app.setErrorHandler"),
    );
    for (const file of ["node.ts", "fastify.ts", "upload-sourcemaps.mjs"]) {
      expect(existsSync(join(cwd, "src", "volato-node", file))).toBe(true);
    }
    const integration = readManifest(cwd)?.integrations[
      ERRORS_NODE_FASTIFY_INTEGRATION
    ];
    expect(integration?.recipe).toBe("errors-node-fastify");
    expect(modifiedGeneratedFiles(cwd, integration!)).toEqual([]);
    expect(result.outcomes.every((outcome) => outcome.status !== "manual")).toBe(
      true,
    );
  });

  it("composes a split CommonJS app and remains convergent", () => {
    writeFileSync(
      join(cwd, "package.json"),
      `${JSON.stringify({
        name: "fastify-cjs",
        type: "commonjs",
        dependencies: { fastify: "5.12.1" },
      }, null, 2)}\n`,
    );
    rmSync(join(cwd, "src", "server.ts"));
    const entryPath = join(cwd, "src", "server.js");
    const appPath = join(cwd, "src", "app.js");
    writeFileSync(entryPath, 'const app = require("./app");\napp.listen({ port: 3000 });\n');
    writeFileSync(
      appPath,
      'const Fastify = require("fastify");\nconst app = Fastify();\nmodule.exports = app;\n',
    );

    const project = detectErrorsStack(cwd).fastify!;
    generateFastifyIntegration({
      cwd,
      project,
      dsn: "https://public@api.volato.dev/project",
    });
    const app = readFileSync(appPath, "utf8");
    expect(app).toContain(
      'const { volatoFastifyErrorHook } = require("./volato-node/fastify.cjs");',
    );

    const second = generateFastifyIntegration({
      cwd,
      project: detectErrorsStack(cwd).fastify!,
      dsn: "https://public@api.volato.dev/project",
    });
    expect(second.outcomes.every((outcome) => outcome.status === "skipped")).toBe(
      true,
    );
  });
});
