import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createGeneratedIntegration,
  ERRORS_BROWSER_SVELTE_INTEGRATION,
  ERRORS_BROWSER_VUE_INTEGRATION,
  ERRORS_NEXTJS_INTEGRATION,
  ERRORS_NUXT_INTEGRATION,
  ERRORS_NODE_FASTIFY_INTEGRATION,
  ERRORS_NODE_NESTJS_INTEGRATION,
  linkProject,
  modifiedGeneratedFiles,
  readManifest,
  writeIntegration,
} from "../integrations/manifest";

let cwd: string;

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), "volato-manifest-"));
});

afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
});

function linkedManifest() {
  return linkProject(cwd, {
    id: "11111111-1111-4111-8111-111111111111",
    name: "Checkout",
  });
}

describe("integration manifest", () => {
  it("links one project before any domain integration is installed", () => {
    expect(linkedManifest()).toEqual({
      schemaVersion: 2,
      project: {
        id: "11111111-1111-4111-8111-111111111111",
        name: "Checkout",
      },
      integrations: {},
    });
    expect(readManifest(cwd)).toEqual(linkedManifest());
  });

  it("composes stable project-relative hashes for an Errors integration", () => {
    linkedManifest();
    const runtimeDir = join(cwd, "src", "volato");
    mkdirSync(runtimeDir, { recursive: true });
    const errors = join(runtimeDir, "errors.ts");
    writeFileSync(errors, "export const errors = true;\n");

    const errorsIntegration = createGeneratedIntegration(cwd, {
      recipe: "errors-nextjs-app-router",
      recipeVersion: "1.0.0",
      files: [errors],
    });
    writeIntegration(cwd, ERRORS_NEXTJS_INTEGRATION, errorsIntegration);

    expect(readManifest(cwd)?.integrations).toEqual({
      [ERRORS_NEXTJS_INTEGRATION]: errorsIntegration,
    });
    expect(modifiedGeneratedFiles(cwd, errorsIntegration)).toEqual([]);
  });

  it.each([
    ERRORS_BROWSER_VUE_INTEGRATION,
    ERRORS_BROWSER_SVELTE_INTEGRATION,
    ERRORS_NODE_FASTIFY_INTEGRATION,
    ERRORS_NODE_NESTJS_INTEGRATION,
    ERRORS_NUXT_INTEGRATION,
  ])("persists the bounded %s adapter identity", (integrationId) => {
    linkedManifest();
    const runtime = join(cwd, `${integrationId}.ts`);
    writeFileSync(runtime, "export const installed = true;\n");
    const integration = createGeneratedIntegration(cwd, {
      recipe: integrationId,
      recipeVersion: "1.0.0",
      files: [runtime],
    });

    writeIntegration(cwd, integrationId, integration);

    expect(readManifest(cwd)?.integrations[integrationId]).toEqual(
      integration,
    );
  });

  it("drops the retired Product integration from an existing manifest", () => {
    mkdirSync(join(cwd, ".volato"));
    writeFileSync(
      join(cwd, ".volato", "manifest.json"),
      `${JSON.stringify({
        schemaVersion: 2,
        project: {
          id: "11111111-1111-4111-8111-111111111111",
          name: "Checkout",
        },
        integrations: {
          "analytics-nextjs": {
            protocolVersion: 1,
            recipe: "analytics-nextjs-app-router",
            recipeVersion: "1.0.0",
            generatedFiles: { "volato/analytics/index.ts": "legacy-hash" },
          },
        },
      })}\n`,
    );

    expect(readManifest(cwd)?.integrations).toEqual({});
  });

  it("detects edited and deleted generated files per integration", () => {
    const runtime = join(cwd, "volato.ts");
    writeFileSync(runtime, "before");
    const integration = createGeneratedIntegration(cwd, {
      recipe: "errors-nextjs-app-router",
      recipeVersion: "1.0.0",
      files: [runtime],
    });

    writeFileSync(runtime, "after");
    expect(modifiedGeneratedFiles(cwd, integration)).toEqual(["volato.ts"]);

    rmSync(runtime);
    expect(modifiedGeneratedFiles(cwd, integration)).toEqual(["volato.ts"]);
  });

  it("migrates a legacy Errors manifest without losing its hashes", () => {
    mkdirSync(join(cwd, ".volato"));
    writeFileSync(
      join(cwd, ".volato", "manifest.json"),
      `${JSON.stringify({
        schemaVersion: 1,
        protocolVersion: 1,
        recipe: "nextjs-app-router",
        recipeVersion: "2.0.1",
        generatedFiles: { "volato/client.tsx": "legacy-hash" },
      })}\n`,
    );

    linkProject(cwd, {
      id: "11111111-1111-4111-8111-111111111111",
      name: "Checkout",
    });

    expect(
      readManifest(cwd)?.integrations[ERRORS_NEXTJS_INTEGRATION],
    ).toEqual({
      protocolVersion: 1,
      recipe: "nextjs-app-router",
      recipeVersion: "2.0.1",
      generatedFiles: { "volato/client.tsx": "legacy-hash" },
    });
  });

  it("refuses to silently relink a repository", () => {
    linkedManifest();
    expect(() =>
      linkProject(cwd, {
        id: "22222222-2222-4222-8222-222222222222",
        name: "Another project",
      }),
    ).toThrow(/already linked/);
    expect(
      JSON.parse(readFileSync(join(cwd, ".volato", "manifest.json"), "utf8"))
        .project.id,
    ).toBe("11111111-1111-4111-8111-111111111111");
  });
});
