import {
  compareReleasesResultSchema,
  errorContextResultSchema,
  errorSamplesResultSchema,
  listProjectsResultSchema,
  listReleasesResultSchema,
  searchErrorGroupsResultSchema,
} from "@volatodev/read-client";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { runtimeMatrix } from "../../../../scripts/errors-runtime-matrix.mjs";
import { NEXTJS_CONFORMANCE_MATRIX } from "../../../../scripts/nextjs-conformance-matrix.mjs";
import { buildDocumentationContract } from "../documentation/contract.js";

const resultSchemas = {
  listProjects: listProjectsResultSchema,
  getErrorContext: errorContextResultSchema,
  searchErrorGroups: searchErrorGroupsResultSchema,
  getErrorSamples: errorSamplesResultSchema,
  listReleases: listReleasesResultSchema,
  compareReleases: compareReleasesResultSchema,
} as const;

describe("generated documentation contract", () => {
  it("derives commands, read shapes, examples, and support from executable authority", () => {
    const contract = buildDocumentationContract(runtimeMatrix);

    expect(contract.schemaVersion).toBe(1);
    expect(contract.cli.commands.map(({ path }) => path.join(" "))).toContain(
      "volato errors list",
    );
    expect(
      contract.cli.commands
        .find(({ path }) => path.join(" ") === "volato errors list")
        ?.options.map(({ long }) => long),
    ).toContain("--cursor");
    expect(Object.keys(contract.reads)).toEqual(Object.keys(resultSchemas));
    for (const [operation, schema] of Object.entries(resultSchemas)) {
      expect(() =>
        schema.parse(contract.reads[operation as keyof typeof resultSchemas].example),
      ).not.toThrow();
    }
    expect(contract.support.totalCells).toBe(108);
    expect(contract.support.families["browser-angular"]).toBeUndefined();
    expect(contract.support.versions.angular).toBeUndefined();
    expect(contract.support.versions.angularBuild).toBeUndefined();
    expect(
      contract.support.refusals.some(({ id }) => id.startsWith("angular.")),
    ).toBe(false);
    expect(contract.support.families).toMatchObject({
      "browser-react": 28,
      "node-long-lived": 24,
      express: 4,
      "node-invocation": 16,
      "browser-vue": 6,
      "browser-svelte": 6,
      fastify: 16,
      "nest-http": 8,
    });
    expect(contract.support.quickstarts.map(({ id }) => id)).toEqual([
      "nextjs",
      "vite-react",
      "vite-vue",
      "vite-svelte",
      "node-express",
      "fastify",
      "nestjs-http",
    ]);
    expect(contract.support.targets.map(({ id }) => id)).toEqual(
      contract.support.quickstarts.map(({ id }) => id),
    );
    expect(contract.support.targets.map(({ label }) => label)).toEqual([
      "Next.js",
      "Vite + React",
      "Vite + Vue",
      "Vite + Svelte",
      "Node.js / Express",
      "Fastify",
      "NestJS HTTP",
    ]);

    const next = contract.support.targets[0];
    expect(next.versions).toEqual(["Next.js 15/16"]);
    expect(next.surfaces.join(" ")).toMatch(/App Router/);
    expect(next.surfaces.join(" ")).toMatch(/Pages Router/);
    expect(next.surfaces.join(" ")).toMatch(/hybrid/);
    expect(new Set(NEXTJS_CONFORMANCE_MATRIX.map(({ next }) => next))).toEqual(
      new Set(["15.5.22", "16.2.12"]),
    );
    expect(new Set(NEXTJS_CONFORMANCE_MATRIX.map(({ router }) => router))).toEqual(
      new Set(["app", "pages", "hybrid"]),
    );

    const node = contract.support.targets.find(
      ({ id }) => id === "node-express",
    );
    expect(node?.surfaces.join(" ")).toMatch(/servers, jobs and scripts/);
    expect(node?.surfaces.join(" ")).toMatch(/Express 4\/5/);
    expect(node?.surfaces.join(" ")).toMatch(/asynchronous generic and Node HTTP/);
    expect(node?.exclusions.join(" ")).toMatch(/Callback-style/);
    expect(node?.exclusions.join(" ")).toMatch(/Streaming/);
    expect(node?.exclusions.join(" ")).toMatch(/promise-returning asynchronous/);
    expect(contract.support.targets.some(({ id }) => id === "node-functions")).toBe(
      false,
    );
    expect(contract.support.targets.some(({ id }) => id === "express")).toBe(false);
    for (const target of contract.support.targets) {
      expect(target.quickstart).toBe(`/docs/start/${target.id}`);
      expect(target.versions.length).toBeGreaterThan(0);
      expect(target.surfaces.length).toBeGreaterThan(0);
      expect(target.exclusions.length).toBeGreaterThan(0);
    }
    const packageScripts = JSON.parse(
      readFileSync(new URL("../../../../package.json", import.meta.url), "utf8"),
    ).scripts as Record<string, string>;
    for (const quickstart of contract.support.quickstarts) {
      for (const command of quickstart.conformance) {
        const script = command.match(/pnpm (smoke:[\w-]+)/)?.[1];
        expect(script, command).toBeDefined();
        expect(packageScripts[script!], command).toBeDefined();
      }
      for (const family of quickstart.families) {
        expect(contract.support.families[family], family).toBeGreaterThan(0);
      }
    }
  });

  it("is byte deterministic", () => {
    expect(JSON.stringify(buildDocumentationContract(runtimeMatrix))).toBe(
      JSON.stringify(buildDocumentationContract(runtimeMatrix)),
    );
  });

  it("commits a versioned JavaScript artefact", () => {
    const committed = JSON.parse(
      readFileSync(
        new URL(
          "../../../../generated/documentation-contract.json",
          import.meta.url,
        ),
        "utf8",
      ),
    ) as ReturnType<typeof buildDocumentationContract>;
    expect(committed.schemaVersion).toBe(1);
    expect(committed.cli.version).toMatch(/^\d+\.\d+\.\d+/);
    expect(committed.support.totalCells).toBe(108);
  });
});
