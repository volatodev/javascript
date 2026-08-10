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
});
