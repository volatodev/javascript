import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

type MatrixCell = {
  id: string;
  wave: "1B" | "1C" | "1D";
  family: "browser-react" | "node-long-lived" | "express" | "node-invocation";
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
});
