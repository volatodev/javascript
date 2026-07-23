import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createManifest,
  modifiedGeneratedFiles,
  readManifest,
  writeManifest,
} from "../integrations/manifest";

let cwd: string;

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), "volato-manifest-"));
});

afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
});

describe("integration manifest", () => {
  it("records stable project-relative hashes", () => {
    const runtimeDir = join(cwd, "src", "volato");
    mkdirSync(runtimeDir, { recursive: true });
    const transport = join(runtimeDir, "transport.ts");
    writeFileSync(transport, "export const transport = true;\n");

    const manifest = createManifest(cwd, {
      recipe: "nextjs-app-router",
      recipeVersion: "1.0.0",
      files: [transport],
    });
    writeManifest(cwd, manifest);

    expect(readManifest(cwd)).toEqual(manifest);
    expect(Object.keys(manifest.generatedFiles)).toEqual([
      "src/volato/transport.ts",
    ]);
    expect(modifiedGeneratedFiles(cwd, manifest)).toEqual([]);
  });

  it("detects edited and deleted generated files", () => {
    const runtime = join(cwd, "volato.ts");
    writeFileSync(runtime, "before");
    const manifest = createManifest(cwd, {
      recipe: "nextjs-app-router",
      recipeVersion: "1.0.0",
      files: [runtime],
    });

    writeFileSync(runtime, "after");
    expect(modifiedGeneratedFiles(cwd, manifest)).toEqual(["volato.ts"]);

    rmSync(runtime);
    expect(modifiedGeneratedFiles(cwd, manifest)).toEqual(["volato.ts"]);
  });
});
