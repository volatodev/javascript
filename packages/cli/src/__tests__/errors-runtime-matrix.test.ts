import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

type MatrixCell = {
  id: string;
  wave:
    | "1B"
    | "1C"
    | "1D"
    | "2A"
    | "2B"
    | "calibration-angular"
    | "calibration-fastapi"
    | "calibration-nuxt"
    | "calibration-sveltekit"
    | "calibration-astro";
  family:
    | "browser-react"
    | "node-long-lived"
    | "express"
    | "node-invocation"
    | "browser-vue"
    | "browser-svelte"
    | "browser-angular"
    | "python-fastapi"
    | "nuxt-nitro"
    | "sveltekit-node"
    | "astro-node"
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

    expect(matrix.frozenAt).toBe("2026-08-28");
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
    expect(
      matrix.cells.filter(
        (cell) =>
          cell.family !== "python-fastapi" &&
          cell.family !== "nuxt-nitro" &&
          cell.family !== "sveltekit-node" &&
          cell.family !== "astro-node",
      ),
    ).toHaveLength(112);
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

  it("publishes the four frozen Angular cells as one bounded target", () => {
    const matrix = readMatrix() as RuntimeMatrix & {
      quickstarts: Array<{ id: string }>;
      targets: Array<{ id: string }>;
    };
    const angular = matrix.cells.filter(
      (cell) => cell.family === "browser-angular",
    );

    expect(matrix.versions).toMatchObject({
      angular: ["20.3.0", "21.2.0", "22.1.0"],
      angularBuild: {
        "20": "20.3.35",
        "21": "21.2.22",
        "22": "22.1.6",
      },
    });
    expect(angular).toHaveLength(4);
    expect(angular.every((cell) => cell.wave === "calibration-angular")).toBe(true);
    expect(angular.every((cell) => cell.visibility === undefined)).toBe(true);
    expect(angular.map((cell) => cell.id)).toEqual([
      "angular20.zone.ts",
      "angular20.zoneless.ts",
      "angular21.zoneless.ts",
      "angular22.zoneless.ts",
    ]);
    expect(matrix.refusals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "angular.version-or-mode" }),
        expect.objectContaining({ id: "angular.ssr-or-workspace" }),
        expect.objectContaining({ id: "angular.builder-or-bootstrap" }),
      ]),
    );
    expect(
      matrix.cells.filter(
        (cell) =>
          cell.family !== "python-fastapi" &&
          cell.family !== "nuxt-nitro" &&
          cell.family !== "sveltekit-node" &&
          cell.family !== "astro-node",
      ),
    ).toHaveLength(112);
    expect(matrix.quickstarts).toContainEqual(
      expect.objectContaining({ id: "angular", skill: "volato-angular" }),
    );
    expect(matrix.targets).toContainEqual(
      expect.objectContaining({ id: "angular", label: "Angular" }),
    );
  });

  it("publishes FastAPI as five maintained-Python cells", () => {
    const matrix = readMatrix() as RuntimeMatrix & {
      quickstarts: Array<{ id: string }>;
      targets: Array<{ id: string }>;
    };
    const fastapi = matrix.cells.filter(
      (cell) => cell.family === "python-fastapi",
    );

    expect(matrix.versions).toMatchObject({
      python: ["3.10", "3.11", "3.12", "3.13", "3.14"],
      fastapi: ["0.141.1"],
      starlette: ["1.6.0"],
      uvicorn: ["0.52.4"],
      pydantic: ["2.13.5"],
      anyio: ["4.14.2"],
    });
    expect(fastapi).toHaveLength(5);
    expect(
      fastapi.every(
        (cell) =>
          cell.wave === "calibration-fastapi" && cell.visibility === undefined,
      ),
    ).toBe(true);
    expect(fastapi.map((cell) => cell.id)).toEqual([
      "fastapi.py310.http",
      "fastapi.py311.http",
      "fastapi.py312.http",
      "fastapi.py313.http",
      "fastapi.py314.http",
    ]);
    expect(matrix.refusals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "fastapi.version-or-bootstrap" }),
        expect.objectContaining({ id: "fastapi.non-http-or-topology" }),
        expect.objectContaining({ id: "fastapi.lifespan-or-background" }),
      ]),
    );
    expect(
      matrix.cells.filter(
        (cell) =>
          cell.family !== "nuxt-nitro" &&
          cell.family !== "sveltekit-node" &&
          cell.family !== "astro-node",
      ),
    ).toHaveLength(117);
    expect(matrix.quickstarts).toContainEqual(
      expect.objectContaining({ id: "fastapi", skill: "volato-fastapi" }),
    );
    expect(matrix.targets).toContainEqual(
      expect.objectContaining({ id: "fastapi", label: "FastAPI" }),
    );
  });

  it("publishes Nuxt/Nitro as six full-stack cells", () => {
    const matrix = readMatrix() as RuntimeMatrix & {
      quickstarts: Array<{ id: string }>;
      targets: Array<{ id: string }>;
    };
    const nuxt = matrix.cells.filter((cell) => cell.family === "nuxt-nitro");

    expect(matrix.versions).toMatchObject({
      nuxt: ["4.5.2"],
      nuxtNitroServer: ["4.5.2"],
      nuxtViteBuilder: ["4.5.2"],
      nitro: ["2.13.4"],
      nuxtVueRouter: ["5.2.0"],
    });
    expect(nuxt).toHaveLength(6);
    expect(
      nuxt.every(
        (cell) =>
          cell.wave === "calibration-nuxt" && cell.visibility === undefined,
      ),
    ).toBe(true);
    expect(nuxt.map((cell) => cell.id)).toEqual([
      "nuxt4.node22.ts",
      "nuxt4.node22.js",
      "nuxt4.node22.mjs",
      "nuxt4.node24.ts",
      "nuxt4.node24.js",
      "nuxt4.node24.mjs",
    ]);
    expect(matrix.refusals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "nuxt.version-or-config" }),
        expect.objectContaining({ id: "nuxt.render-or-preset" }),
        expect.objectContaining({ id: "nuxt.hybrid-or-lifecycle" }),
      ]),
    );
    expect(
      matrix.cells.filter(
        (cell) => cell.family !== "sveltekit-node" && cell.family !== "astro-node",
      ),
    ).toHaveLength(123);
    expect(matrix.quickstarts).toContainEqual(
      expect.objectContaining({ id: "nuxt", skill: "volato-nuxt" }),
    );
    expect(matrix.targets).toContainEqual(
      expect.objectContaining({ id: "nuxt", label: "Nuxt" }),
    );
  });

  it("publishes SvelteKit as four adapter-node cells", () => {
    const matrix = readMatrix() as RuntimeMatrix & {
      quickstarts: Array<{ id: string }>;
      targets: Array<{ id: string }>;
    };
    const sveltekit = matrix.cells.filter(
      (cell) => cell.family === "sveltekit-node",
    );

    expect(matrix.versions).toMatchObject({
      svelte: ["5.56.10"],
      svelteKit: ["2.70.3"],
      svelteKitAdapterNode: ["5.5.7"],
      svelteKitVitePlugin: ["7.3.0"],
      vite: ["6.4.3", "7.3.6", "8.2.2"],
    });
    expect(sveltekit).toHaveLength(4);
    expect(
      sveltekit.every(
        (cell) =>
          cell.wave === "calibration-sveltekit" &&
          cell.visibility === undefined,
      ),
    ).toBe(true);
    expect(sveltekit.map((cell) => cell.id)).toEqual([
      "sveltekit2.node22.ts",
      "sveltekit2.node22.js",
      "sveltekit2.node24.ts",
      "sveltekit2.node24.js",
    ]);
    expect(matrix.refusals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "sveltekit.version-or-config" }),
        expect.objectContaining({ id: "sveltekit.adapter-or-output" }),
        expect.objectContaining({ id: "sveltekit.lifecycle-or-hooks" }),
      ]),
    );
    expect(matrix.cells.filter((cell) => cell.family !== "astro-node")).toHaveLength(127);
    expect(matrix.quickstarts).toContainEqual(
      expect.objectContaining({ id: "sveltekit", skill: "volato-sveltekit" }),
    );
    expect(matrix.targets).toContainEqual(
      expect.objectContaining({ id: "sveltekit", label: "SvelteKit" }),
    );
  });

  it("freezes Astro as sixteen private standalone-node renderer cells", () => {
    const matrix = readMatrix() as RuntimeMatrix & {
      quickstarts: Array<{ id: string }>;
      targets: Array<{ id: string }>;
    };
    const astro = matrix.cells.filter((cell) => cell.family === "astro-node");

    expect(matrix.versions).toMatchObject({
      astro: ["7.2.9"],
      astroNodeAdapter: ["11.1.4"],
      astroReact: ["6.0.4"],
      astroVue: ["7.0.2"],
      astroSvelte: ["9.0.1"],
      react: ["18.3.1", "19.2.8"],
      vue: ["3.5.42"],
      svelte: ["5.56.10"],
      vite: ["6.4.3", "7.3.6", "8.2.2"],
    });
    expect(astro).toHaveLength(16);
    expect(
      astro.every(
        (cell) =>
          cell.wave === "calibration-astro" &&
          cell.visibility === "private-calibration" &&
          cell.adapter === "@astrojs/node" &&
          cell.adapterMode === "standalone",
      ),
    ).toBe(true);
    expect(astro.map((cell) => cell.id)).toEqual([
      "astro7.node22.ts.core",
      "astro7.node22.ts.react",
      "astro7.node22.ts.vue",
      "astro7.node22.ts.svelte",
      "astro7.node22.js.core",
      "astro7.node22.js.react",
      "astro7.node22.js.vue",
      "astro7.node22.js.svelte",
      "astro7.node24.ts.core",
      "astro7.node24.ts.react",
      "astro7.node24.ts.vue",
      "astro7.node24.ts.svelte",
      "astro7.node24.js.core",
      "astro7.node24.js.react",
      "astro7.node24.js.vue",
      "astro7.node24.js.svelte",
    ]);
    expect(matrix.refusals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "astro.version-or-config" }),
        expect.objectContaining({ id: "astro.output-or-adapter" }),
        expect.objectContaining({ id: "astro.renderer-or-hydration" }),
        expect.objectContaining({ id: "astro.lifecycle-or-actions" }),
      ]),
    );
    expect(matrix.cells).toHaveLength(143);
    expect(matrix.quickstarts.some(({ id }) => id === "astro")).toBe(false);
    expect(matrix.targets.some(({ id }) => id === "astro")).toBe(false);
  });
});
