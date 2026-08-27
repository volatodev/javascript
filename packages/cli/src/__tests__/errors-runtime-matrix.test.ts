import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

type MatrixCell = {
  id: string;
  wave: "1B" | "1C" | "1D" | "2A" | "2B";
  family:
    | "browser-react"
    | "node-long-lived"
    | "express"
    | "node-invocation"
    | "browser-vue"
    | "browser-svelte"
    | "fastify"
    | "nest-http";
  gates: string[];
  [key: string]: unknown;
};

type RuntimeMatrix = {
  frozenAt: string;
  versions: Record<string, unknown>;
  supportGates: string[];
  cells: MatrixCell[];
  refusals: Array<{ id: string; reason: string }>;
};

const matrixScript = fileURLToPath(
  new URL("../../../../scripts/errors-runtime-matrix.mjs", import.meta.url),
);

function readMatrix(): RuntimeMatrix {
  return JSON.parse(
    execFileSync(process.execPath, [matrixScript, "--json"], {
      encoding: "utf8",
    }),
  ) as RuntimeMatrix;
}

describe("Errors JavaScript runtime conformance matrix", () => {
  it("names every frozen cell and maps it to all eight support gates", () => {
    const matrix = readMatrix();
    const ids = matrix.cells.map((cell) => cell.id);

    expect(matrix.frozenAt).toBe("2026-08-27");
    expect(matrix.supportGates).toEqual([
      "exact-detection",
      "deterministic-installation",
      "promised-capture",
      "bounded-privacy",
      "lifecycle-correctness",
      "source-correctness",
      "version-conformance",
      "agent-recovery-canary",
    ]);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every((id) => /^[a-z0-9][a-z0-9.-]+$/.test(id))).toBe(true);
    expect(
      matrix.cells.every(
        (cell) =>
          cell.gates.length === matrix.supportGates.length &&
          matrix.supportGates.every((gate) => cell.gates.includes(gate)),
      ),
    ).toBe(true);

    expect(
      Object.fromEntries(
        ["browser-react", "node-long-lived", "express", "node-invocation"].map(
          (family) => [
            family,
            matrix.cells.filter((cell) => cell.family === family).length,
          ],
        ),
      ),
    ).toEqual({
      "browser-react": 28,
      "node-long-lived": 24,
      express: 4,
      "node-invocation": 16,
    });
  });

  it("freezes maintained versions and refuses unproven lifecycle shapes", () => {
    const matrix = readMatrix();

    expect(matrix.versions).toMatchObject({
      node: ["22.23.2", "24.19.0"],
      react: ["18.3.1", "19.2.8"],
      vite: ["6.4.3", "7.3.6", "8.2.2"],
      webpack: ["5.109.2"],
      rspack: ["2.2.0"],
      express: ["4.22.2", "5.2.1"],
      typescript: ["5.9.3"],
    });
    expect(matrix.refusals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "browser.non-react-renderer" }),
        expect.objectContaining({ id: "browser.dynamic-build-config" }),
        expect.objectContaining({ id: "node.ambiguous-entry" }),
        expect.objectContaining({ id: "invocation.callback" }),
        expect.objectContaining({ id: "invocation.streaming" }),
        expect.objectContaining({ id: "invocation.sync" }),
        expect.objectContaining({ id: "provider-presets" }),
      ]),
    );
  });

  it("freezes the selected JavaScript framework expansion versions", () => {
    const matrix = readMatrix();

    expect(matrix.versions).toMatchObject({
      vue: ["3.5.42"],
      viteVuePlugin: ["6.0.8"],
      svelte: ["5.56.10"],
      viteSveltePlugin: {
        "6": "6.2.4",
        "7": "6.2.4",
        "8": "7.3.0",
      },
      fastify: ["5.12.1"],
      nest: ["11.2.3", "12.0.1"],
      nestCli: ["11.0.24"],
      nestExpress: {
        "11": "5.2.1",
        "12": "5.2.1",
      },
      nestFastify: {
        "11": "5.11.3",
        "12": "5.12.1",
      },
    });
  });

  it("enumerates every selected framework cell and refusal boundary", () => {
    const matrix = readMatrix();

    expect(
      Object.fromEntries(
        ["browser-vue", "browser-svelte", "fastify", "nest-http"].map(
          (family) => [
            family,
            matrix.cells.filter((cell) => cell.family === family).length,
          ],
        ),
      ),
    ).toEqual({
      "browser-vue": 6,
      "browser-svelte": 6,
      fastify: 16,
      "nest-http": 8,
    });
    expect(matrix.cells).toHaveLength(108);
    expect(matrix.refusals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "vue.ssr-or-ambiguous-root" }),
        expect.objectContaining({ id: "svelte.ssr-or-ambiguous-root" }),
        expect.objectContaining({ id: "fastify.v4-or-ambiguous-instance" }),
        expect.objectContaining({ id: "fastify.unsupported-lifecycle" }),
        expect.objectContaining({ id: "nest.pre-v11-or-non-http" }),
        expect.objectContaining({ id: "nest.ambiguous-filter-or-application" }),
      ]),
    );
  });
});
