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
import { generateNodeIntegration } from "../integrations/node";
import {
  ERRORS_NODE_INTEGRATION,
  linkProject,
  modifiedGeneratedFiles,
  readManifest,
} from "../integrations/manifest";

let cwd: string;

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), "volato-node-"));
  mkdirSync(join(cwd, "src"));
  writeFileSync(
    join(cwd, "package.json"),
    `${JSON.stringify({
      name: "fixture",
      type: "module",
      scripts: { build: "tsup src/server.ts --format esm --sourcemap" },
      dependencies: { express: "5.1.0" },
    }, null, 2)}\n`,
  );
  writeFileSync(
    join(cwd, "src", "server.ts"),
    'import express from "express";\nconst app = express();\napp.get("/health", (_req, res) => res.send("ok"));\nconst server = app.listen(3000);\n',
  );
  linkProject(cwd, {
    id: "11111111-1111-4111-8111-111111111111",
    name: "Fixture",
  });
});

afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
});

describe("Node + Express generated integration", () => {
  it("generates executable CommonJS source for a no-build JavaScript job", () => {
    writeFileSync(
      join(cwd, "package.json"),
      `${JSON.stringify({
        name: "worker",
        type: "commonjs",
      }, null, 2)}\n`,
    );
    rmSync(join(cwd, "src", "server.ts"));
    writeFileSync(
      join(cwd, "src", "job.js"),
      "#!/usr/bin/env node\nrunJob();\n",
    );

    const project = detectErrorsStack(cwd).node!;
    const result = generateNodeIntegration({
      cwd,
      project,
      dsn: "https://pk@api.volato.dev/project",
    });

    const entry = readFileSync(project.entryPath, "utf8");
    expect(entry).toMatch(/^#!\/usr\/bin\/env node\nconst \{ initVolatoNode \} = require\("\.\/volato-node\/node\.cjs"\);/);
    expect(existsSync(join(cwd, "src", "volato-node", "node.cjs"))).toBe(
      true,
    );
    expect(readFileSync(join(cwd, "src", "volato-node", "node.cjs"), "utf8")).toContain(
      "module.exports",
    );
    expect(result.outcomes.every((outcome) => outcome.status !== "manual")).toBe(
      true,
    );
  });

  it("generates executable ESM source for a no-build JavaScript script", () => {
    writeFileSync(
      join(cwd, "package.json"),
      `${JSON.stringify({ name: "script", type: "module" }, null, 2)}\n`,
    );
    rmSync(join(cwd, "src", "server.ts"));
    writeFileSync(join(cwd, "src", "index.js"), "await runScript();\n");

    const project = detectErrorsStack(cwd).node!;
    const result = generateNodeIntegration({
      cwd,
      project,
      dsn: "https://pk@api.volato.dev/project",
    });

    expect(readFileSync(project.entryPath, "utf8")).toMatch(
      /^import \{ initVolatoNode \} from "\.\/volato-node\/node\.js";/,
    );
    expect(existsSync(join(cwd, "src", "volato-node", "node.js"))).toBe(true);
    expect(result.outcomes.every((outcome) => outcome.status !== "manual")).toBe(
      true,
    );
  });

  it("requires and then recognizes explicit composition with existing fatal handlers", () => {
    writeFileSync(
      join(cwd, "package.json"),
      `${JSON.stringify({
        name: "worker",
        type: "module",
        scripts: { build: "tsc --sourceMap" },
      }, null, 2)}\n`,
    );
    writeFileSync(
      join(cwd, "tsconfig.json"),
      `${JSON.stringify({ compilerOptions: { outDir: "dist" } }, null, 2)}\n`,
    );
    const entryPath = join(cwd, "src", "server.ts");
    const original = `process.on("uncaughtException", async (error) => {
  await closeDatabase();
  process.exit(1);
});
process.on("unhandledRejection", async (reason) => {
  await closeDatabase();
  process.exit(1);
});
startServer();
`;
    writeFileSync(entryPath, original);
    const project = detectErrorsStack(cwd).node!;

    const first = generateNodeIntegration({
      cwd,
      project,
      dsn: "https://pk@api.volato.dev/project",
    });

    expect(first.outcomes).toContainEqual(
      expect.objectContaining({
        path: entryPath,
        status: "manual",
        detail: expect.stringMatching(
          /captureNodeException.*installFatalHandlers: false.*original handlers/i,
        ),
      }),
    );
    expect(readFileSync(entryPath, "utf8")).toBe(original);

    writeFileSync(
      entryPath,
      `import { captureNodeException, initVolatoNode } from "./volato-node/node.js";
initVolatoNode({ installFatalHandlers: false });
process.on("uncaughtException", async (error) => {
  await captureNodeException(error, { capturedVia: "uncaught_exception" });
  await closeDatabase();
  process.exit(1);
});
process.on("unhandledRejection", async (reason) => {
  await captureNodeException(reason, { capturedVia: "unhandled_rejection" });
  await closeDatabase();
  process.exit(1);
});
startServer();
`,
    );

    const second = generateNodeIntegration({
      cwd,
      project,
      dsn: "https://pk@api.volato.dev/project",
    });
    expect(second.outcomes.every((outcome) => outcome.status !== "manual")).toBe(
      true,
    );
  });

  it("installs fatal runtime capture, Express context, and a post-build map upload", () => {
    const project = detectErrorsStack(cwd).node!;
    const result = generateNodeIntegration({
      cwd,
      project,
      dsn: "https://pk@api.volato.dev/project",
      ingestToken: "server-only-token",
    });

    for (const path of ["node.ts", "express.ts", "upload-sourcemaps.mjs"]) {
      expect(existsSync(join(cwd, "src", "volato-node", path))).toBe(true);
    }
    const entry = readFileSync(project.entryPath, "utf8");
    expect(entry).toContain("initVolatoNode");
    expect(entry).toContain("volatoExpressErrorHandler");
    expect(entry.indexOf("app.get")).toBeLessThan(
      entry.indexOf("app.use(volatoExpressErrorHandler())"),
    );
    expect(entry.indexOf("app.use(volatoExpressErrorHandler())")).toBeLessThan(
      entry.indexOf("app.listen"),
    );
    expect(entry).toContain("const server = app.listen(3000)");
    expect(
      JSON.parse(readFileSync(join(cwd, "package.json"), "utf8")).scripts.build,
    ).toContain("upload-sourcemaps.mjs dist");
    expect(readFileSync(join(cwd, ".env.local"), "utf8")).toContain(
      "VOLATO_DSN=https://pk@api.volato.dev/project",
    );

    const integration = readManifest(cwd)?.integrations[
      ERRORS_NODE_INTEGRATION
    ];
    expect(integration?.recipe).toBe("errors-node-express");
    expect(modifiedGeneratedFiles(cwd, integration!)).toEqual([]);
    expect(result.outcomes.every((outcome) => outcome.status !== "manual")).toBe(
      true,
    );
  });

  it("installs generic Node capture without claiming Express HTTP context", () => {
    writeFileSync(
      join(cwd, "package.json"),
      `${JSON.stringify({
        name: "worker",
        type: "module",
        scripts: { build: "tsup src/server.ts --format esm --sourcemap" },
      }, null, 2)}\n`,
    );

    const result = generateNodeIntegration({
      cwd,
      project: detectErrorsStack(cwd).node!,
      dsn: "https://pk@api.volato.dev/project",
    });

    expect(result.outcomes).toContainEqual(
      expect.objectContaining({ detail: expect.stringMatching(/without Express/i) }),
    );
    expect(readFileSync(join(cwd, "src", "server.ts"), "utf8")).not.toContain(
      "volatoExpressErrorHandler",
    );
  });

  it("uses the TypeScript outDir for the sourcemap uploader", () => {
    writeFileSync(
      join(cwd, "package.json"),
      `${JSON.stringify({
        name: "fixture",
        type: "module",
        scripts: { build: "tsc --sourceMap" },
        dependencies: { express: "5.1.0" },
      }, null, 2)}\n`,
    );
    writeFileSync(
      join(cwd, "tsconfig.json"),
      `${JSON.stringify({ compilerOptions: { outDir: "build" } }, null, 2)}\n`,
    );

    const result = generateNodeIntegration({
      cwd,
      project: detectErrorsStack(cwd).node!,
      dsn: "https://pk@api.volato.dev/project",
    });

    const build = JSON.parse(
      readFileSync(join(cwd, "package.json"), "utf8"),
    ).scripts.build as string;
    expect(build).toContain("upload-sourcemaps.mjs build");
    expect(result.outcomes).toContainEqual(
      expect.objectContaining({
        status: "updated",
        detail: expect.stringContaining("from build"),
      }),
    );
  });

  it("leaves an explicit manual action for an ambiguous build output", () => {
    writeFileSync(
      join(cwd, "package.json"),
      `${JSON.stringify({
        name: "fixture",
        type: "module",
        scripts: { build: "node scripts/build.mjs --source-map" },
        dependencies: { express: "5.1.0" },
      }, null, 2)}\n`,
    );

    const result = generateNodeIntegration({
      cwd,
      project: detectErrorsStack(cwd).node!,
      dsn: "https://pk@api.volato.dev/project",
    });

    expect(result.outcomes).toContainEqual(
      expect.objectContaining({
        path: join(cwd, "package.json"),
        status: "manual",
        detail: expect.stringMatching(/output directory is ambiguous/i),
      }),
    );
    expect(
      JSON.parse(readFileSync(join(cwd, "package.json"), "utf8")).scripts
        .build,
    ).toBe("node scripts/build.mjs --source-map");
  });

  it("accepts a reviewed postbuild uploader after an ambiguous build", () => {
    writeFileSync(
      join(cwd, "package.json"),
      `${JSON.stringify({
        name: "fixture",
        type: "module",
        scripts: { build: "node scripts/build.mjs --source-map" },
        dependencies: { express: "5.1.0" },
      }, null, 2)}\n`,
    );

    const first = generateNodeIntegration({
      cwd,
      project: detectErrorsStack(cwd).node!,
      dsn: "https://pk@api.volato.dev/project",
    });
    expect(first.outcomes).toContainEqual(
      expect.objectContaining({ status: "manual" }),
    );

    const packageJson = JSON.parse(
      readFileSync(join(cwd, "package.json"), "utf8"),
    );
    packageJson.scripts.postbuild =
      "node src/volato-node/upload-sourcemaps.mjs dist";
    writeFileSync(
      join(cwd, "package.json"),
      `${JSON.stringify(packageJson, null, 2)}\n`,
    );

    const second = generateNodeIntegration({
      cwd,
      project: detectErrorsStack(cwd).node!,
      dsn: "https://pk@api.volato.dev/project",
    });

    expect(second.outcomes.every((outcome) => outcome.status !== "manual")).toBe(
      true,
    );
    expect(second.outcomes).toContainEqual(
      expect.objectContaining({
        path: join(cwd, "package.json"),
        status: "skipped",
        detail: expect.stringMatching(/already follows build/i),
      }),
    );
  });
});
