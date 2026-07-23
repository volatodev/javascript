import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";

export const MANIFEST_SCHEMA_VERSION = 1;

export type IntegrationManifest = {
  schemaVersion: 1;
  protocolVersion: 1;
  recipe: string;
  recipeVersion: string;
  generatedFiles: Record<string, string>;
};

export function hashContents(contents: string | Buffer): string {
  return createHash("sha256").update(contents).digest("hex");
}

export function manifestPath(cwd: string): string {
  return join(cwd, ".volato", "manifest.json");
}

export function readManifest(cwd: string): IntegrationManifest | null {
  const path = manifestPath(cwd);
  if (!existsSync(path)) return null;
  const value = JSON.parse(
    readFileSync(path, "utf8"),
  ) as Partial<IntegrationManifest>;
  if (
    value.schemaVersion !== MANIFEST_SCHEMA_VERSION ||
    value.protocolVersion !== 1 ||
    typeof value.recipe !== "string" ||
    typeof value.recipeVersion !== "string" ||
    !value.generatedFiles ||
    typeof value.generatedFiles !== "object"
  ) {
    throw new Error(`Invalid Volato integration manifest: ${path}`);
  }
  return value as IntegrationManifest;
}

export function createManifest(
  cwd: string,
  options: {
    recipe: string;
    recipeVersion: string;
    files: string[];
  },
): IntegrationManifest {
  const entries: Array<[string, string]> = options.files
      .map((path): [string, string] => [
        relative(cwd, path).replaceAll("\\", "/"),
        hashContents(readFileSync(path)),
      ])
      .sort(([left], [right]) => left.localeCompare(right));
  const generatedFiles = Object.fromEntries(entries);
  return {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    protocolVersion: 1,
    recipe: options.recipe,
    recipeVersion: options.recipeVersion,
    generatedFiles,
  };
}

export function writeManifest(
  cwd: string,
  manifest: IntegrationManifest,
): string {
  const path = manifestPath(cwd);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return path;
}

export function modifiedGeneratedFiles(
  cwd: string,
  manifest: IntegrationManifest,
): string[] {
  return Object.entries(manifest.generatedFiles)
    .filter(([path, expectedHash]) => {
      const absolute = join(cwd, path);
      return (
        !existsSync(absolute) ||
        hashContents(readFileSync(absolute)) !== expectedHash
      );
    })
    .map(([path]) => path);
}
