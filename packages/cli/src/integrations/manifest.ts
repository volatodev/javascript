import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";

export const MANIFEST_SCHEMA_VERSION = 2;
export const ERRORS_NEXTJS_INTEGRATION = "errors-nextjs" as const;
export const ERRORS_VITE_REACT_INTEGRATION = "errors-vite-react" as const;
export const ERRORS_NODE_INTEGRATION = "errors-node" as const;
export const ANALYTICS_NEXTJS_INTEGRATION = "analytics-nextjs" as const;

export type IntegrationId =
  | typeof ERRORS_NEXTJS_INTEGRATION
  | typeof ERRORS_VITE_REACT_INTEGRATION
  | typeof ERRORS_NODE_INTEGRATION
  | typeof ANALYTICS_NEXTJS_INTEGRATION;

export type GeneratedIntegration = {
  protocolVersion: 1;
  recipe: string;
  recipeVersion: string;
  generatedFiles: Record<string, string>;
};

export type IntegrationManifest = {
  schemaVersion: 2;
  project: {
    id: string;
    name: string;
  };
  integrations: Partial<Record<IntegrationId, GeneratedIntegration>>;
};

type LegacyIntegrationManifest = {
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

function isGeneratedFiles(value: unknown): value is Record<string, string> {
  return (
    !!value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.entries(value).every(
      ([path, hash]) => path.length > 0 && typeof hash === "string",
    )
  );
}

function parseGeneratedIntegration(
  value: unknown,
  path: string,
): GeneratedIntegration {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Invalid Volato generated integration: ${path}`);
  }
  const integration = value as Partial<GeneratedIntegration>;
  if (
    integration.protocolVersion !== 1 ||
    typeof integration.recipe !== "string" ||
    typeof integration.recipeVersion !== "string" ||
    !isGeneratedFiles(integration.generatedFiles)
  ) {
    throw new Error(`Invalid Volato generated integration: ${path}`);
  }
  return integration as GeneratedIntegration;
}

function parseManifest(value: unknown, path: string): IntegrationManifest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Invalid Volato integration manifest: ${path}`);
  }
  const manifest = value as Partial<IntegrationManifest>;
  if (
    manifest.schemaVersion !== MANIFEST_SCHEMA_VERSION ||
    !manifest.project ||
    typeof manifest.project.id !== "string" ||
    manifest.project.id.length === 0 ||
    typeof manifest.project.name !== "string" ||
    manifest.project.name.length === 0 ||
    !manifest.integrations ||
    typeof manifest.integrations !== "object" ||
    Array.isArray(manifest.integrations)
  ) {
    throw new Error(`Invalid Volato integration manifest: ${path}`);
  }
  const integrations: IntegrationManifest["integrations"] = {};
  for (const [id, integration] of Object.entries(manifest.integrations)) {
    if (
      id !== ERRORS_NEXTJS_INTEGRATION &&
      id !== ERRORS_VITE_REACT_INTEGRATION &&
      id !== ERRORS_NODE_INTEGRATION &&
      id !== ANALYTICS_NEXTJS_INTEGRATION
    ) {
      throw new Error(`Unsupported Volato integration ${JSON.stringify(id)}: ${path}`);
    }
    integrations[id] = parseGeneratedIntegration(
      integration,
      `${path}#integrations.${id}`,
    );
  }
  return {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    project: manifest.project,
    integrations,
  };
}

function readRawManifest(cwd: string): unknown | null {
  const path = manifestPath(cwd);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as unknown;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid Volato integration manifest ${path}: ${detail}`);
  }
}

function parseLegacyManifest(
  value: unknown,
  path: string,
): LegacyIntegrationManifest | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const legacy = value as Partial<LegacyIntegrationManifest>;
  if (legacy.schemaVersion !== 1) return null;
  const integration = parseGeneratedIntegration(
    {
      protocolVersion: legacy.protocolVersion,
      recipe: legacy.recipe,
      recipeVersion: legacy.recipeVersion,
      generatedFiles: legacy.generatedFiles,
    },
    path,
  );
  return { schemaVersion: 1, ...integration };
}

export function readManifest(cwd: string): IntegrationManifest | null {
  const value = readRawManifest(cwd);
  if (value === null) return null;
  return parseManifest(value, manifestPath(cwd));
}

export function linkProject(
  cwd: string,
  project: { id: string; name: string },
): IntegrationManifest {
  const path = manifestPath(cwd);
  const value = readRawManifest(cwd);
  let integrations: IntegrationManifest["integrations"] = {};

  if (value !== null) {
    if (
      typeof value === "object" &&
      value !== null &&
      !Array.isArray(value) &&
      (value as { schemaVersion?: unknown }).schemaVersion ===
        MANIFEST_SCHEMA_VERSION
    ) {
      const current = parseManifest(value, path);
      if (current.project.id !== project.id) {
        throw new Error(
          `This repository is already linked to Volato project ${current.project.id}. Unlink it explicitly before choosing another project.`,
        );
      }
      integrations = current.integrations;
    } else {
      const legacy = parseLegacyManifest(value, path);
      if (!legacy) {
        throw new Error(`Invalid Volato integration manifest: ${path}`);
      }
      integrations = {
        [ERRORS_NEXTJS_INTEGRATION]: {
          protocolVersion: legacy.protocolVersion,
          recipe: legacy.recipe,
          recipeVersion: legacy.recipeVersion,
          generatedFiles: legacy.generatedFiles,
        },
      };
    }
  }

  const manifest: IntegrationManifest = {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    project,
    integrations,
  };
  writeManifest(cwd, manifest);
  return manifest;
}

export function createGeneratedIntegration(
  cwd: string,
  options: {
    recipe: string;
    recipeVersion: string;
    files: string[];
  },
): GeneratedIntegration {
  const entries: Array<[string, string]> = options.files
    .map((path): [string, string] => [
      relative(cwd, path).replaceAll("\\", "/"),
      hashContents(readFileSync(path)),
    ])
    .sort(([left], [right]) => left.localeCompare(right));
  return {
    protocolVersion: 1,
    recipe: options.recipe,
    recipeVersion: options.recipeVersion,
    generatedFiles: Object.fromEntries(entries),
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

export function writeIntegration(
  cwd: string,
  id: IntegrationId,
  integration: GeneratedIntegration,
): string {
  const manifest = readManifest(cwd);
  if (!manifest) {
    throw new Error("This repository is not linked to Volato. Run `volato init --project <id>` first.");
  }
  return writeManifest(cwd, {
    ...manifest,
    integrations: {
      ...manifest.integrations,
      [id]: integration,
    },
  });
}

export function linkedProject(cwd: string): IntegrationManifest["project"] {
  const manifest = readManifest(cwd);
  if (!manifest) {
    throw new Error("This repository is not linked to Volato. Run `volato init --project <id>` first.");
  }
  return manifest.project;
}

export function modifiedGeneratedFiles(
  cwd: string,
  integration: GeneratedIntegration,
): string[] {
  return Object.entries(integration.generatedFiles)
    .filter(([path, expectedHash]) => {
      const absolute = join(cwd, path);
      return (
        !existsSync(absolute) ||
        hashContents(readFileSync(absolute)) !== expectedHash
      );
    })
    .map(([path]) => path);
}
