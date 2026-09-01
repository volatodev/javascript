import { fileURLToPath } from "node:url";
import { NEXTJS_CONFORMANCE_MATRIX } from "./nextjs-conformance-matrix.mjs";

function unique(values) {
  return [...new Set(values)];
}

function majorVersions(values) {
  return unique(values.map((value) => value.split(".")[0])).join("/");
}

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
  next: unique(NEXTJS_CONFORMANCE_MATRIX.map(({ next }) => next)),
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
  svelteKit: ["2.70.3"],
  svelteKitAdapterNode: ["5.5.7"],
  svelteKitVitePlugin: ["7.3.0"],
  astro: ["7.2.9"],
  astroNodeAdapter: ["11.1.4"],
  astroReact: ["6.0.4"],
  astroVue: ["7.0.2"],
  astroSvelte: ["9.0.1"],
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
  angular: ["20.3.0", "21.2.0", "22.1.0"],
  angularBuild: {
    20: "20.3.35",
    21: "21.2.22",
    22: "22.1.6",
  },
  python: ["3.10", "3.11", "3.12", "3.13", "3.14"],
  fastapi: ["0.141.1"],
  starlette: ["1.6.0"],
  uvicorn: ["0.52.4"],
  pydantic: ["2.13.5"],
  anyio: ["4.14.2"],
  nuxt: ["4.5.2"],
  nuxtNitroServer: ["4.5.2"],
  nuxtViteBuilder: ["4.5.2"],
  nitro: ["2.13.4"],
  nuxtVueRouter: ["5.2.0"],
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

const browserAngularCells = [
  {
    id: "angular20.zone.ts",
    angular: versions.angular[0],
    changeDetection: "zonejs",
  },
  {
    id: "angular20.zoneless.ts",
    angular: versions.angular[0],
    changeDetection: "zoneless",
  },
  {
    id: "angular21.zoneless.ts",
    angular: versions.angular[1],
    changeDetection: "zoneless",
  },
  {
    id: "angular22.zoneless.ts",
    angular: versions.angular[2],
    changeDetection: "zoneless",
  },
].map((cell) =>
  withGates({
    ...cell,
    wave: "calibration-angular",
    family: "browser-angular",
    adapter: "angular-application",
    adapterVersion: versions.angularBuild[cell.angular.split(".")[0]],
    language: "ts",
    module: "esm",
    topology: "standalone-application-config",
    outputTopology: "default-dist-project-browser",
    capture: [
      "manual",
      "window-error",
      "unhandled-rejection",
      "angular-error-handler",
    ],
  }),
);

const pythonFastApiCells = versions.python.map((python) =>
  withGates({
    id: `fastapi.py${python.replace(".", "")}.http`,
    wave: "calibration-fastapi",
    family: "python-fastapi",
    python,
    framework: "fastapi",
    frameworkVersion: versions.fastapi[0],
    adapter: "starlette-pure-asgi",
    adapterVersion: versions.starlette[0],
    server: "uvicorn",
    serverVersion: versions.uvicorn[0],
    topology: "module-app",
    artifact: "direct-python-source",
    capture: ["manual", "asgi-http"],
    explicitRefusals: ["lifespan", "background", "websocket", "streaming"],
  }),
);

const nuxtNitroCells = versions.node.flatMap((node) =>
  ["ts", "js", "mjs"].map((configFormat) =>
    withGates({
      id: `nuxt4.node${node.split(".")[0]}.${configFormat}`,
      wave: "calibration-nuxt",
      family: "nuxt-nitro",
      nuxt: versions.nuxt[0],
      nitro: versions.nitro[0],
      vue: versions.vue[0],
      vueRouter: versions.nuxtVueRouter[0],
      vite: versions.vite[2],
      node,
      config: `nuxt.config.${configFormat}`,
      language: configFormat === "ts" ? "ts" : "js",
      module: "esm",
      topology: "ssr-vite-node-server",
      outputTopology: "output-public-nuxt-and-output-server",
      capture: [
        "browser-global",
        "unhandled-rejection",
        "vue-error",
        "nuxt-app-error",
        "ssr",
        "nitro-error",
      ],
    }),
  ),
);

const svelteKitCells = versions.node.flatMap((node) =>
  ["ts", "js"].map((language) =>
    withGates({
      id: `sveltekit2.node${node.split(".")[0]}.${language}`,
      wave: "calibration-sveltekit",
      family: "sveltekit-node",
      svelte: versions.svelte[0],
      svelteKit: versions.svelteKit[0],
      adapter: "adapter-node",
      adapterVersion: versions.svelteKitAdapterNode[0],
      vitePlugin: versions.svelteKitVitePlugin[0],
      vite: versions.vite[2],
      node,
      config: `vite.config.${language}`,
      language,
      module: "esm",
      topology: "ssr-vite-adapter-node",
      outputTopology: "build-client-server-and-sveltekit-intermediate",
      capture: [
        "browser-global",
        "unhandled-rejection",
        "sveltekit-client-handle-error",
        "ssr",
        "server-load",
        "action",
        "endpoint",
        "sveltekit-server-handle-error",
      ],
    }),
  ),
);

const astroNodeCells = versions.node.flatMap((node) =>
  ["ts", "js"].flatMap((language) =>
    ["core", "react", "vue", "svelte"].map((renderer) =>
      withGates({
        id: `astro7.node${node.split(".")[0]}.${language}.${renderer}`,
        wave: "calibration-astro",
        family: "astro-node",
        visibility: "private-calibration",
        astro: versions.astro[0],
        adapter: "@astrojs/node",
        adapterVersion: versions.astroNodeAdapter[0],
        adapterMode: "standalone",
        renderer,
        rendererVersion:
          renderer === "react"
            ? versions.astroReact[0]
            : renderer === "vue"
              ? versions.astroVue[0]
              : renderer === "svelte"
                ? versions.astroSvelte[0]
                : null,
        runtimeVersion:
          renderer === "react"
            ? versions.react[1]
            : renderer === "vue"
              ? versions.vue[0]
              : renderer === "svelte"
                ? versions.svelte[0]
                : null,
        vite: versions.vite[2],
        node,
        config: "astro.config.mjs",
        language,
        module: "esm",
        topology: "on-demand-standalone-node",
        outputTopology: "dist-client-and-dist-server",
        hydration: renderer === "core" ? [] : ["client:load"],
        capture: [
          "browser-global",
          "unhandled-rejection",
          "astro-middleware",
          "render",
          "endpoint",
          "server-island",
          ...(renderer === "react"
            ? ["react-hydration"]
            : renderer === "vue"
              ? ["vue-error-handler"]
              : renderer === "svelte"
                ? ["astro-hydration-error"]
                : []),
        ],
      }),
    ),
  ),
);

const refusals = [
  {
    id: "next.version-or-root",
    reason: "Next.js versions outside 15/16 and Next.js 16 mixed-root hybrid applications are refused before mutation.",
  },
  {
    id: "next.manual-composition",
    reason: "Existing unwrapped middleware or proxy, an existing App Router error boundary, and custom Next.js 16 build commands require reviewed manual composition.",
  },
  {
    id: "browser.non-react-renderer",
    reason: "Vanilla-browser and other renderers require their own adapter gates.",
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
    id: "browser.server-not-implied",
    reason: "Browser capture does not imply capture for a Node.js backend; that application must be selected and integrated independently.",
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
    reason: "Vue 2, Vue SSR, Nuxt, hydration, multiple roots and dynamic createApp composition are outside the Vite client promise.",
  },
  {
    id: "svelte.ssr-or-ambiguous-root",
    reason: "Svelte 4, SvelteKit, SSR, hydration, multiple roots and dynamic mount composition are outside the Vite client promise.",
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
    reason: "Nest versions before 11 and GraphQL, gateways, WebSockets, microservices, hybrid, serverless or standalone application contexts are outside the HTTP promise.",
  },
  {
    id: "nest.ambiguous-filter-or-application",
    reason: "Multiple applications, custom HTTP adapters and non-composable exception filters require an exact manual outcome before any mutation.",
  },
  {
    id: "angular.version-or-mode",
    reason: "Angular outside 20/21/22, ambiguous Angular 20 change detection and Angular 21/22 Zone.js overrides are refused before mutation.",
  },
  {
    id: "angular.ssr-or-workspace",
    reason: "Angular SSR, prerendering, hydration, libraries, nested roots and zero or multiple application projects are outside the client-rendered support boundary.",
  },
  {
    id: "angular.builder-or-bootstrap",
    reason: "Alternate builders, custom output paths or build scripts, NgModule/dynamic bootstrap and non-static ApplicationConfig ownership are refused before mutation.",
  },
  {
    id: "fastapi.version-or-bootstrap",
    reason: "Python outside maintained 3.10-3.14, dependency drift, app factories and alternate or multiple FastAPI bootstraps are refused before mutation.",
  },
  {
    id: "fastapi.non-http-or-topology",
    reason: "Direct Starlette, WSGI, mounted applications, WebSockets, streaming/SSE, serverless wrappers and multiple application topologies are outside the FastAPI HTTP support boundary.",
  },
  {
    id: "fastapi.lifespan-or-background",
    reason: "Lifespan and post-response background-task failures remain explicit refusals until their independent propagation and flush lifecycles are proven.",
  },
  {
    id: "nuxt.version-or-config",
    reason: "Nuxt, Nitro, Vue, Vue Router or Vite dependency drift, dynamic config, custom builders, layers and multi-app roots are refused before mutation.",
  },
  {
    id: "nuxt.render-or-preset",
    reason: "Static generation, ssr:false, edge, serverless, provider, Deno and Bun presets are outside the long-lived Node calibration.",
  },
  {
    id: "nuxt.hybrid-or-lifecycle",
    reason: "Hybrid route rules, prerendering, ISR and unproven streaming or alternate Nitro lifecycles are refused before mutation.",
  },
  {
    id: "sveltekit.version-or-config",
    reason: "Svelte, SvelteKit, adapter-node, Vite plugin, Vite or Node drift, CommonJS, legacy Svelte config, dynamic Vite config and multi-app roots are refused before mutation.",
  },
  {
    id: "sveltekit.adapter-or-output",
    reason: "Adapter-auto, static, provider, edge, serverless and custom adapters, adapter options, custom roots, outputs and bundle strategies are outside the standalone Node calibration.",
  },
  {
    id: "sveltekit.lifecycle-or-hooks",
    reason: "SSR-disabled, prerendered, service-worker, remote-function, experimental rendering, ambiguous hook, streaming, WebSocket, background and process-fatal lifecycles are refused before mutation.",
  },
  {
    id: "astro.version-or-config",
    visibility: "private-calibration",
    reason: "Astro, Vite, Node or renderer dependency drift, dynamic configuration, custom roots and multi-application repositories are refused before mutation.",
  },
  {
    id: "astro.output-or-adapter",
    visibility: "private-calibration",
    reason: "Static output, prerendering, adapter middleware mode, provider, edge, Deno, Bun, custom adapters and custom output directories are outside the standalone Node calibration.",
  },
  {
    id: "astro.renderer-or-hydration",
    visibility: "private-calibration",
    reason: "Mixed renderers, renderer options and hydration directives other than client:load are refused until independently conformed.",
  },
  {
    id: "astro.lifecycle-or-actions",
    visibility: "private-calibration",
    reason: "Astro Actions, streaming-after-commit, background work and process-fatal failures are outside the middleware and island lifecycle calibration.",
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
  {
    id: "angular",
    families: ["browser-angular"],
    skill: "volato-angular",
    conformance: ["pnpm smoke:angular-calibration"],
  },
  {
    id: "fastapi",
    families: ["python-fastapi"],
    skill: "volato-fastapi",
    conformance: ["pnpm smoke:fastapi-calibration"],
  },
  {
    id: "nuxt",
    families: ["nuxt-nitro"],
    skill: "volato-nuxt",
    conformance: ["VOLATO_NUXT_EXACT_NODE=1 pnpm smoke:nuxt-calibration"],
  },
  {
    id: "sveltekit",
    families: ["sveltekit-node"],
    skill: "volato-sveltekit",
    conformance: ["pnpm smoke:sveltekit-calibration"],
  },
];

const conformedNextRouters = unique(
  NEXTJS_CONFORMANCE_MATRIX.map(({ router }) => router),
);
const expectedNextRouters = ["app", "pages", "hybrid"];
if (
  conformedNextRouters.length !== expectedNextRouters.length ||
  expectedNextRouters.some((router) => !conformedNextRouters.includes(router))
) {
  throw new Error(
    `Public Next.js router projection is incomplete: ${conformedNextRouters.join(", ")}`,
  );
}

const supportTargets = [
  {
    id: "nextjs",
    label: "Next.js",
    description: "App Router, Pages Router, or a hybrid application",
    versions: [`Next.js ${majorVersions(versions.next)}`],
    surfaces: [
      "App Router, Pages Router and hybrid App + Pages applications in TypeScript or JavaScript.",
      "Browser and React render failures; App Router RSC, server actions, route handlers, middleware and Next.js 16 proxy.",
      "Pages Router render, SSR and API Routes; build identity and browser/server sourcemap upload.",
    ],
    refusalIds: ["next.version-or-root", "next.manual-composition"],
  },
  {
    id: "vite-react",
    label: "Vite + React",
    description: "React browser application on Vite, Webpack, or Rspack",
    versions: [
      `React ${majorVersions(versions.react)}`,
      `Vite ${majorVersions(versions.vite)}`,
      `Webpack ${majorVersions(versions.webpack)}`,
      `Rspack ${majorVersions(versions.rspack)}`,
    ],
    surfaces: [
      "Browser manual capture, window errors, unhandled rejections and React render failures.",
      "TypeScript or JavaScript client applications built with Vite, Webpack or Rspack.",
    ],
    refusalIds: [
      "browser.dynamic-build-config",
      "browser.ambiguous-root-or-boundary",
      "browser.server-not-implied",
    ],
  },
  {
    id: "vite-vue",
    label: "Vite + Vue",
    description: "Vue 3 single-page application on Vite",
    versions: [
      `Vue ${majorVersions(versions.vue)}`,
      `Vite ${majorVersions(versions.vite)}`,
    ],
    surfaces: [
      "Client-rendered TypeScript or JavaScript Vue single-page applications on Vite.",
      "Browser manual capture, window errors, unhandled rejections and Vue render failures.",
    ],
    refusalIds: ["vue.ssr-or-ambiguous-root", "browser.server-not-implied"],
  },
  {
    id: "vite-svelte",
    label: "Vite + Svelte",
    description: "Svelte 5 single-page application on Vite",
    versions: [
      `Svelte ${majorVersions(versions.svelte)}`,
      `Vite ${majorVersions(versions.vite)}`,
    ],
    surfaces: [
      "Client-rendered TypeScript or JavaScript Svelte single-page applications on Vite.",
      "Browser manual capture, window errors, unhandled rejections and Svelte render failures.",
    ],
    refusalIds: ["svelte.ssr-or-ambiguous-root", "browser.server-not-implied"],
  },
  {
    id: "node-express",
    label: "Node.js / Express",
    description: "Server, job, async function, or Express 4/5",
    versions: [
      `Node.js ${majorVersions(versions.node)}`,
      `Express ${majorVersions(versions.express)}`,
    ],
    surfaces: [
      "Long-lived Node.js servers, jobs and scripts in TypeScript or JavaScript with package-declared ESM or CommonJS.",
      "Express 4/5 same-file and split app/listen HTTP topologies while preserving application-owned handlers.",
      "Provider-neutral asynchronous generic and Node HTTP invocation handlers with bounded end-of-invocation flush.",
    ],
    refusalIds: [
      "node.ambiguous-entry",
      "node.unknown-build-output",
      "invocation.callback",
      "invocation.sync",
      "invocation.streaming",
      "provider-presets",
    ],
  },
  {
    id: "fastify",
    label: "Fastify",
    description: "Fastify 5 standalone HTTP server",
    versions: [
      `Fastify ${majorVersions(versions.fastify)}`,
      `Node.js ${majorVersions(versions.node)}`,
    ],
    surfaces: [
      "Standalone long-lived Fastify HTTP applications in TypeScript or JavaScript with ESM or CommonJS.",
      "Conventional same-file and split bootstrap topologies with framework-owned request lifecycle preserved.",
    ],
    refusalIds: [
      "fastify.v4-or-ambiguous-instance",
      "fastify.unsupported-lifecycle",
    ],
  },
  {
    id: "nestjs-http",
    label: "NestJS HTTP",
    description: "NestJS 11/12 HTTP on Express or Fastify",
    versions: [
      `NestJS ${majorVersions(versions.nest)}`,
      `Node.js ${majorVersions(versions.node)}`,
      `Express ${majorVersions(Object.values(versions.nestExpress))}`,
      `Fastify ${majorVersions(Object.values(versions.nestFastify))}`,
    ],
    surfaces: [
      "Conventional TypeScript/CommonJS NestJS HTTP applications using Express or Fastify.",
      "Controller, guard, pipe and interceptor failures under one Nest-owned HTTP capture boundary.",
    ],
    refusalIds: [
      "nest.pre-v11-or-non-http",
      "nest.ambiguous-filter-or-application",
    ],
  },
  {
    id: "angular",
    label: "Angular",
    description: "Angular client-rendered application on the official application builder",
    versions: [
      `Angular ${majorVersions(versions.angular)}`,
      `@angular/build ${majorVersions(Object.values(versions.angularBuild))}`,
    ],
    surfaces: [
      "Client-rendered standalone TypeScript Angular applications on the official application builder.",
      "Angular 20 with its fresh Zone.js default or explicit zoneless mode, and Angular 21/22 in their fresh zoneless mode.",
      "Browser manual capture, window errors, unhandled rejections and Angular component or lifecycle failures.",
    ],
    refusalIds: [
      "angular.version-or-mode",
      "angular.ssr-or-workspace",
      "angular.builder-or-bootstrap",
    ],
  },
  {
    id: "fastapi",
    label: "FastAPI",
    description: "Conventional long-lived FastAPI HTTP application",
    versions: [
      `FastAPI 0.141`,
      `Python ${versions.python.join("/")}`,
    ],
    surfaces: [
      "Conventional long-lived FastAPI HTTP applications on Python 3.10-3.14 with one module-level app bootstrap.",
      "Manual capture and unexpected route, dependency and application-middleware failures through one pure ASGI boundary.",
      "Concurrent request propagation with bounded method, matched route, status and existing request-id context.",
    ],
    refusalIds: [
      "fastapi.version-or-bootstrap",
      "fastapi.non-http-or-topology",
      "fastapi.lifespan-or-background",
    ],
  },
  {
    id: "nuxt",
    label: "Nuxt",
    description: "Nuxt 4.5 SSR on Vite and long-lived Nitro Node",
    versions: [
      "Nuxt 4.5",
      "Nitro 2.13",
      `Vue ${majorVersions(versions.vue)}`,
      `Vite ${majorVersions(versions.vite.slice(-1))}`,
      `Node.js ${majorVersions(versions.node)}`,
    ],
    surfaces: [
      "Conventional Nuxt 4.5 SSR applications on Vite with the long-lived Nitro node-server preset.",
      "Browser globals, unhandled rejections, client Vue and application hooks, SSR, Nitro routes and startup failures.",
      "Client and server sourcemaps with exact Vue, TypeScript or JavaScript source resolution under one release.",
    ],
    refusalIds: [
      "nuxt.version-or-config",
      "nuxt.render-or-preset",
      "nuxt.hybrid-or-lifecycle",
    ],
  },
  {
    id: "sveltekit",
    label: "SvelteKit",
    description: "SvelteKit 2.70 SSR on the official standalone Node adapter",
    versions: [
      "SvelteKit 2.70",
      `Svelte ${majorVersions(versions.svelte)}`,
      `adapter-node ${majorVersions(versions.svelteKitAdapterNode)}`,
      `Vite ${majorVersions(versions.vite.slice(-1))}`,
      `Node.js ${majorVersions(versions.node)}`,
    ],
    surfaces: [
      "Conventional SvelteKit 2.70 SSR applications on Vite with the official standalone adapter-node output.",
      "Browser globals, unhandled rejections, client navigation and load failures, SSR, server loads, actions and endpoints.",
      "Client, final-server and intermediate-server sourcemaps with exact Svelte, TypeScript or JavaScript source resolution.",
    ],
    refusalIds: [
      "sveltekit.version-or-config",
      "sveltekit.adapter-or-output",
      "sveltekit.lifecycle-or-hooks",
    ],
  },
];

export const runtimeMatrix = {
  frozenAt: "2026-08-28",
  publicFrozenAt: "2026-09-01",
  privateVersionKeys: [
    "astro",
    "astroNodeAdapter",
    "astroReact",
    "astroVue",
    "astroSvelte",
  ],
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
    ...browserAngularCells,
    ...pythonFastApiCells,
    ...nuxtNitroCells,
    ...svelteKitCells,
    ...astroNodeCells,
  ],
  refusals,
  quickstarts,
  targets: supportTargets,
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
  const targetIds = matrix.targets.map(({ id }) => id);
  if (JSON.stringify(targetIds) !== JSON.stringify(quickstartIds)) {
    throw new Error("Public support targets must match quickstarts in exact order");
  }
  const refusalIds = new Set(matrix.refusals.map(({ id }) => id));
  for (const target of matrix.targets) {
    if (
      !target.label ||
      !target.description ||
      target.versions.length === 0 ||
      target.surfaces.length === 0 ||
      target.refusalIds.length === 0
    ) {
      throw new Error(`Incomplete public support target: ${target.id}`);
    }
    for (const refusalId of target.refusalIds) {
      if (!refusalIds.has(refusalId)) {
        throw new Error(`${target.id} maps unknown refusal ${refusalId}`);
      }
    }
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
