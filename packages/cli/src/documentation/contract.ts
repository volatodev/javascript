import {
  compareReleasesInputSchema,
  compareReleasesResultSchema,
  errorContextResultSchema,
  errorSamplesResultSchema,
  getErrorContextInputSchema,
  getErrorSamplesInputSchema,
  listProjectsInputSchema,
  listProjectsResultSchema,
  listReleasesInputSchema,
  listReleasesResultSchema,
  searchErrorGroupsInputSchema,
  searchErrorGroupsResultSchema,
} from "@volatodev/read-client";
import { cliProgram } from "../cli.js";
import { cliDocumentationModel } from "./commander.js";

type RuntimeCell = {
  id: string;
  family: string;
  [key: string]: unknown;
};

type SupportTarget = {
  id: string;
  label: string;
  description: string;
  versions: string[];
  surfaces: string[];
  refusalIds: string[];
};

type RuntimeMatrix = {
  frozenAt: string;
  versions: Record<string, unknown>;
  supportGates: string[];
  cells: RuntimeCell[];
  refusals: Array<{ id: string; reason: string }>;
  quickstarts: Array<{
    id: string;
    families: string[];
    skill: string;
    conformance: string[];
  }>;
  targets: SupportTarget[];
};

const UUID = "11111111-1111-4111-8111-111111111111";
const DATE = "2026-08-27T10:00:00.000Z";

const releaseExample = {
  release: "release-abc123",
  commitShas: ["abc123"],
  projectIds: [UUID],
  runtimes: ["node"],
  eventCount: 1,
  groupCount: 1,
  firstSeen: DATE,
  lastSeen: DATE,
};

const readDefinitions = {
  listProjects: {
    input: listProjectsInputSchema,
    result: listProjectsResultSchema,
    example: {
      kind: "ok",
      projects: [
        {
          id: UUID,
          name: "Checkout",
          active: true,
          createdAt: DATE,
          lastEventAt: DATE,
        },
      ],
      nextCursor: null,
    },
  },
  getErrorContext: {
    input: getErrorContextInputSchema,
    result: errorContextResultSchema,
    example: {
      group: { id: UUID, message: "Controlled failure" },
      events: [],
      commitTransition: null,
      resolvedFrame: null,
      resolutionState: null,
      history: [],
      affectedUsers: null,
      similarResolved: [],
    },
  },
  searchErrorGroups: {
    input: searchErrorGroupsInputSchema,
    result: searchErrorGroupsResultSchema,
    example: { kind: "ok", rows: [], nextCursor: null, query: {} },
  },
  getErrorSamples: {
    input: getErrorSamplesInputSchema,
    result: errorSamplesResultSchema,
    example: {
      kind: "ok",
      group: {
        id: UUID,
        projectId: UUID,
        message: "Controlled failure",
        fingerprint: "controlled-failure",
      },
      samples: [],
      scan: { candidatesConsidered: 0, candidateLimit: 200 },
      query: {},
      privacy: "Privacy-filtered bounded samples.",
    },
  },
  listReleases: {
    input: listReleasesInputSchema,
    result: listReleasesResultSchema,
    example: {
      kind: "ok",
      releases: [releaseExample],
      latest: releaseExample,
      previous: null,
      nextCursor: null,
      query: {},
    },
  },
  compareReleases: {
    input: compareReleasesInputSchema,
    result: compareReleasesResultSchema,
    example: {
      kind: "ok",
      head: releaseExample,
      base: { ...releaseExample, release: "release-before" },
      summary: { new: 0, aggravated: 0, fixed: 0 },
      changes: [],
      nextCursor: null,
      query: {},
    },
  },
};

function assertRuntimeMatrix(value: unknown): asserts value is RuntimeMatrix {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Documentation support authority must be a runtime matrix.");
  }
  const matrix = value as Partial<RuntimeMatrix>;
  if (
    typeof matrix.frozenAt !== "string" ||
    !matrix.versions ||
    typeof matrix.versions !== "object" ||
    !Array.isArray(matrix.supportGates) ||
    !Array.isArray(matrix.cells) ||
    !Array.isArray(matrix.refusals) ||
    !Array.isArray(matrix.quickstarts) ||
    !Array.isArray(matrix.targets)
  ) {
    throw new Error("Documentation support authority is incomplete.");
  }
  for (const cell of matrix.cells) {
    if (
      !cell ||
      typeof cell !== "object" ||
      typeof cell.id !== "string" ||
      typeof cell.family !== "string"
    ) {
      throw new Error("Documentation support authority contains an invalid cell.");
    }
  }
  for (const target of matrix.targets) {
    if (
      !target ||
      typeof target !== "object" ||
      typeof target.id !== "string" ||
      typeof target.label !== "string" ||
      typeof target.description !== "string" ||
      !Array.isArray(target.versions) ||
      !Array.isArray(target.surfaces) ||
      !Array.isArray(target.refusalIds)
    ) {
      throw new Error("Documentation support authority contains an invalid target.");
    }
  }
}

function readModel() {
  return Object.fromEntries(
    Object.entries(readDefinitions).map(
      ([name, definition]) => [
        name,
        {
          inputSchema: definition.input.toJSONSchema({ io: "input" }),
          resultSchema: definition.result.toJSONSchema({ io: "output" }),
          example: definition.result.parse(definition.example),
        },
      ],
    ),
  ) as {
    [Name in keyof typeof readDefinitions]: {
      inputSchema: ReturnType<
        (typeof readDefinitions)[Name]["input"]["toJSONSchema"]
      >;
      resultSchema: ReturnType<
        (typeof readDefinitions)[Name]["result"]["toJSONSchema"]
      >;
      example: unknown;
    };
  };
}

export function buildDocumentationContract(runtimeMatrix: unknown) {
  assertRuntimeMatrix(runtimeMatrix);
  const families: Record<string, number> = {};
  for (const cell of runtimeMatrix.cells) {
    families[cell.family] = (families[cell.family] ?? 0) + 1;
  }
  const refusalById = new Map(
    runtimeMatrix.refusals.map((refusal) => [refusal.id, refusal.reason]),
  );
  const targets = runtimeMatrix.targets.map((target) => ({
    id: target.id,
    label: target.label,
    description: target.description,
    versions: target.versions,
    surfaces: target.surfaces,
    exclusions: target.refusalIds.map((refusalId) => {
      const reason = refusalById.get(refusalId);
      if (!reason) {
        throw new Error(
          `Documentation support target ${target.id} maps unknown refusal ${refusalId}.`,
        );
      }
      return reason;
    }),
    quickstart: `/docs/start/${target.id}`,
  }));

  return {
    schemaVersion: 1 as const,
    generatedFrom: {
      cli: "packages/cli/src/cli.ts",
      reads: "packages/read-client/src/contracts.ts",
      support: "scripts/errors-runtime-matrix.mjs",
    },
    cli: cliDocumentationModel(cliProgram),
    reads: readModel(),
    support: {
      frozenAt: runtimeMatrix.frozenAt,
      totalCells: runtimeMatrix.cells.length,
      families,
      versions: runtimeMatrix.versions,
      gates: runtimeMatrix.supportGates,
      cells: runtimeMatrix.cells,
      refusals: runtimeMatrix.refusals,
      quickstarts: runtimeMatrix.quickstarts,
      targets,
    },
  };
}
