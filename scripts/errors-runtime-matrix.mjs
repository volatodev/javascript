import { fileURLToPath } from "node:url";

const supportGates = [
  "exact-detection",
  "deterministic-installation",
  "promised-capture",
  "bounded-privacy",
  "lifecycle-correctness",
  "source-correctness",
  "version-conformance",
  "agent-recovery-canary",
];

const versions = {
  node: ["22.23.2", "24.19.0"],
  react: ["18.3.1", "19.2.8"],
  vite: ["6.4.3", "7.3.6", "8.2.2"],
  webpack: ["5.109.2"],
  webpackCli: ["7.2.2"],
  rspack: ["2.2.0"],
  express: ["4.22.2", "5.2.1"],
  vue: ["3.5.42"],
  viteVuePlugin: ["6.0.8"],
  svelte: ["5.56.10"],
  viteSveltePlugin: {
    6: "6.2.4",
    7: "6.2.4",
    8: "7.3.0",
  },
  fastify: ["5.12.1"],
  nest: ["11.2.3", "12.0.1"],
  nestCli: ["11.0.24"],
  nestExpress: {
    11: "5.2.1",
    12: "5.2.1",
  },
  nestFastify: {
    11: "5.11.3",
    12: "5.12.1",
  },
  typescript: ["5.9.3"],
};

function withGates(cell) {
  return { ...cell, gates: [...supportGates] };
}

const browserCells = [];
for (const react of versions.react) {
  const reactMajor = react.split(".")[0];
  for (const vite of versions.vite) {
    const viteMajor = vite.split(".")[0];
    for (const [language, config] of [
      ["ts", "vite.config.ts"],
      ["js", "vite.config.js"],
    ]) {
      browserCells.push(
        withGates({
          id: `browser.vite${viteMajor}.react${reactMajor}.${language}`,
          wave: "1B",
          family: "browser-react",
          adapter: "vite",
          adapterVersion: vite,
          react,
          language,
          config,
          module: "esm",
          rootTopology: "clean-create-root",
          outputTopology: "default-and-custom-base",
          capture: ["manual", "window-error", "unhandled-rejection", "render"],
        }),
      );
    }
  }

  for (const language of ["ts", "js"]) {
    for (const [module, config] of [
      ["esm", "webpack.config.mjs"],
      ["cjs", "webpack.config.cjs"],
    ]) {
      browserCells.push(
        withGates({
          id: `browser.webpack5.react${reactMajor}.${language}.${module}`,
          wave: "1B",
          family: "browser-react",
          adapter: "webpack",
          adapterVersion: versions.webpack[0],
          react,
          language,
          config,
          module,
          rootTopology: "clean-create-root",
          outputTopology: "contenthash-and-custom-public-path",
          capture: ["manual", "window-error", "unhandled-rejection", "render"],
        }),
      );
    }

    for (const [module, config] of [
      ["esm", "rspack.config.mjs"],
      ["ts", "rspack.config.ts"],
    ]) {
      browserCells.push(
        withGates({
          id: `browser.rspack2.react${reactMajor}.${language}.${module}`,
          wave: "1B",
          family: "browser-react",
          adapter: "rspack",
          adapterVersion: versions.rspack[0],
          react,
          language,
          config,
          module,
          rootTopology: "clean-create-root",
          outputTopology: "contenthash-and-custom-public-path",
          capture: ["manual", "window-error", "unhandled-rejection", "render"],
        }),
      );
    }
  }
}

const longLivedNodeCells = [];
for (const node of versions.node) {
  const nodeMajor = node.split(".")[0];
  for (const language of ["ts", "js"]) {
    for (const module of ["esm", "cjs"]) {
      for (const processShape of ["server", "job", "script"]) {
        longLivedNodeCells.push(
          withGates({
            id: `node${nodeMajor}.${processShape}.${language}.${module}`,
            wave: "1C",
            family: "node-long-lived",
            node,
            language,
            module,
            processShape,
            artifact: language === "ts" ? "tsc-sourcemap" : "direct-source",
            capture: ["manual", "uncaught-exception", "unhandled-rejection"],
          }),
        );
      }
    }
  }
}

const expressCells = [];
for (const express of versions.express) {
  const expressMajor = express.split(".")[0];
  for (const topology of ["same-file", "split-bootstrap"]) {
    const sameFile = topology === "same-file";
    expressCells.push(
      withGates({
        id: `express${expressMajor}.${topology}`,
        wave: "1C",
        family: "express",
        express,
        node: versions.node[1],
        language: sameFile ? "ts" : "js",
        module: sameFile ? "esm" : "cjs",
        topology,
        asyncPropagation:
          expressMajor === "5" ? "returned-promise" : "explicit-next",
        capture: ["sync-route", "framework-propagated-async"],
      }),
    );
  }
}

const invocationCells = [];
for (const node of versions.node) {
  const nodeMajor = node.split(".")[0];
  for (const language of ["ts", "js"]) {
    for (const module of ["esm", "cjs"]) {
      for (const handlerShape of ["async-handler", "node-http-handler"]) {
        invocationCells.push(
          withGates({
            id: `invocation.node${nodeMajor}.${handlerShape}.${language}.${module}`,
            wave: "1D",
            family: "node-invocation",
            node,
            language,
            module,
            handlerShape,
            artifact: language === "ts" ? "tsc-sourcemap" : "direct-source",
            lifecycle: ["cold", "warm", "concurrent-warm"],
            capture: ["throw", "rejection"],
            flushTimeoutMs: 2_000,
          }),
        );
      }
    }
  }
}

const browserVueCells = [];
for (const vite of versions.vite) {
  const viteMajor = vite.split(".")[0];
  for (const language of ["ts", "js"]) {
    browserVueCells.push(
      withGates({
        id: `browser.vite${viteMajor}.vue3.${language}`,
        wave: "2A",
        family: "browser-vue",
        adapter: "vite",
        adapterVersion: vite,
        adapterPluginVersion: versions.viteVuePlugin[0],
        vue: versions.vue[0],
        language,
        config: language === "ts" ? "vite.config.ts" : "vite.config.js",
        module: "esm",
        rootTopology: "clean-create-app",
        outputTopology: "default-and-custom-base",
        capture: [
          "manual",
          "window-error",
          "unhandled-rejection",
          "vue-error-handler",
        ],
      }),
    );
  }
}

const browserSvelteCells = [];
for (const vite of versions.vite) {
  const viteMajor = vite.split(".")[0];
  for (const language of ["ts", "js"]) {
    browserSvelteCells.push(
      withGates({
        id: `browser.vite${viteMajor}.svelte5.${language}`,
        wave: "2A",
        family: "browser-svelte",
        adapter: "vite",
        adapterVersion: vite,
        adapterPluginVersion: versions.viteSveltePlugin[viteMajor],
        svelte: versions.svelte[0],
        language,
        config: language === "ts" ? "vite.config.ts" : "vite.config.js",
        module: "esm",
        rootTopology: "clean-mount",
        outputTopology: "default-and-custom-base",
        capture: [
          "manual",
          "window-error",
          "unhandled-rejection",
          "svelte-boundary",
        ],
      }),
    );
  }
}

const fastifyCells = [];
for (const node of versions.node) {
  const nodeMajor = node.split(".")[0];
  for (const language of ["ts", "js"]) {
    for (const module of ["esm", "cjs"]) {
      for (const topology of ["same-file", "split-bootstrap"]) {
        fastifyCells.push(
          withGates({
            id: `fastify5.node${nodeMajor}.${language}.${module}.${topology}`,
            wave: "2B",
            family: "fastify",
            fastify: versions.fastify[0],
            node,
            language,
            module,
            topology,
            artifact: language === "ts" ? "tsc-sourcemap" : "direct-source",
            capture: ["sync-route", "async-route", "lifecycle-hook"],
          }),
        );
      }
    }
  }
}

const nestHttpCells = [];
for (const nest of versions.nest) {
  const nestMajor = nest.split(".")[0];
  for (const node of versions.node) {
    const nodeMajor = node.split(".")[0];
    for (const transport of ["express", "fastify"]) {
      nestHttpCells.push(
        withGates({
          id: `nest${nestMajor}.node${nodeMajor}.${transport}`,
          wave: "2B",
          family: "nest-http",
          nest,
          nestCli: versions.nestCli[0],
          node,
          language: "ts",
          module: "cjs",
          topology: "conventional-main",
          transport,
          transportVersion:
            transport === "express"
              ? versions.nestExpress[nestMajor]
              : versions.nestFastify[nestMajor],
          artifact: "nest-cli-sourcemap",
          capture: ["controller", "guard", "pipe", "interceptor"],
        }),
      );
    }
  }
}

const refusals = [
  {
    id: "browser.non-react-renderer",
    reason: "Angular, vanilla-browser and other renderers require their own adapter gates.",
  },
  {
    id: "browser.dynamic-build-config",
    reason: "Dynamic, promised or multi-configuration build exports require one precise manual composition and are not mutated automatically.",
  },
  {
    id: "browser.ambiguous-root-or-boundary",
    reason: "Multiple roots or an existing React boundary require one precise manual composition before setup can be ready.",
  },
  {
    id: "node.ambiguous-entry",
    reason: "Multiple conventional process entries require an explicit application entry and are not modified.",
  },
  {
    id: "node.unknown-build-output",
    reason: "Unknown output directories require a reviewed postbuild uploader command.",
  },
  {
    id: "invocation.callback",
    reason: "Callback-style invocation completion is outside the promise.",
  },
  {
    id: "invocation.streaming",
    reason: "Streaming response completion is outside the promise.",
  },
  {
    id: "invocation.sync",
    reason: "Only promise-returning asynchronous handlers are wrapped automatically.",
  },
  {
    id: "provider-presets",
    reason: "AWS Lambda, Vercel, Netlify, Google Cloud and Azure remain candidate presets until each lifecycle is independently conformed.",
  },
  {
    id: "vue.ssr-or-ambiguous-root",
    reason: "Vue SSR, Nuxt, multiple roots and dynamic createApp composition are outside the Vite client promise.",
  },
  {
    id: "svelte.ssr-or-ambiguous-root",
    reason: "SvelteKit, SSR, hydration, multiple roots and dynamic mount composition are outside the Vite client promise.",
  },
  {
    id: "fastify.v4-or-ambiguous-instance",
    reason: "Fastify 4 is end-of-life and multiple or dynamic Fastify instances are not mutated automatically.",
  },
  {
    id: "fastify.unsupported-lifecycle",
    reason: "WebSockets, HTTP/2-specific behaviour, streaming, SSE and serverless completion require separate lifecycle gates.",
  },
  {
    id: "nest.pre-v11-or-non-http",
    reason: "Nest versions before 11 and GraphQL, gateways, microservices, hybrid or standalone application contexts are outside the HTTP promise.",
  },
  {
    id: "nest.ambiguous-filter-or-application",
    reason: "Multiple applications, custom HTTP adapters and non-composable exception filters require an exact manual outcome before any mutation.",
  },
];

const quickstarts = [
  {
    id: "nextjs",
    families: [],
    skill: "volato-nextjs",
    conformance: ["VOLATO_CLI_SPEC=pack pnpm smoke:nextjs"],
  },
  {
    id: "vite-react",
    families: ["browser-react"],
    skill: "volato-vite-react",
    conformance: ["pnpm smoke:browser-react"],
  },
  {
    id: "vite-vue",
    families: ["browser-vue"],
    skill: "volato-vite-vue",
    conformance: ["pnpm smoke:vite-vue"],
  },
  {
    id: "vite-svelte",
    families: ["browser-svelte"],
    skill: "volato-vite-svelte",
    conformance: ["pnpm smoke:vite-svelte"],
  },
  {
    id: "node-express",
    families: ["node-long-lived", "express"],
    skill: "volato-node",
    conformance: [
      "VOLATO_CLI_SPEC=pack pnpm smoke:node-long-lived",
      "VOLATO_CLI_SPEC=pack pnpm smoke:express",
    ],
  },
  {
    id: "fastify",
    families: ["fastify"],
    skill: "volato-fastify",
    conformance: ["VOLATO_CLI_SPEC=pack pnpm smoke:fastify"],
  },
  {
    id: "nestjs-http",
    families: ["nest-http"],
    skill: "volato-nestjs",
    conformance: ["pnpm smoke:nest"],
  },
];

export const runtimeMatrix = {
  frozenAt: "2026-08-27",
  versions,
  supportGates,
  cells: [
    ...browserCells,
    ...longLivedNodeCells,
    ...expressCells,
    ...invocationCells,
    ...browserVueCells,
    ...browserSvelteCells,
    ...fastifyCells,
    ...nestHttpCells,
  ],
  refusals,
  quickstarts,
};

function validate(matrix) {
  const ids = matrix.cells.map((cell) => cell.id);
  if (new Set(ids).size !== ids.length) throw new Error("Matrix cell IDs must be unique");
  for (const cell of matrix.cells) {
    if (!cell.id || !cell.wave || !cell.family) {
      throw new Error(`Unnamed matrix cell: ${JSON.stringify(cell)}`);
    }
    for (const gate of supportGates) {
      if (!cell.gates.includes(gate)) {
        throw new Error(`${cell.id} does not map support gate ${gate}`);
      }
    }
  }
  const quickstartIds = matrix.quickstarts.map(({ id }) => id);
  if (new Set(quickstartIds).size !== quickstartIds.length) {
    throw new Error("Quickstart IDs must be unique");
  }
  const families = new Set(matrix.cells.map((cell) => cell.family));
  for (const quickstart of matrix.quickstarts) {
    if (!quickstart.skill || quickstart.conformance.length === 0) {
      throw new Error(`Incomplete quickstart proof: ${quickstart.id}`);
    }
    for (const family of quickstart.families) {
      if (!families.has(family)) {
        throw new Error(`${quickstart.id} maps unknown family ${family}`);
      }
    }
  }
}

validate(runtimeMatrix);

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.includes("--json")) {
    process.stdout.write(`${JSON.stringify(runtimeMatrix, null, 2)}\n`);
  } else {
    const counts = Object.groupBy(runtimeMatrix.cells, (cell) => cell.family);
    for (const [family, cells] of Object.entries(counts)) {
      process.stdout.write(`${family}: ${cells.length} cells\n`);
    }
    process.stdout.write(`total: ${runtimeMatrix.cells.length} cells\n`);
  }
}
