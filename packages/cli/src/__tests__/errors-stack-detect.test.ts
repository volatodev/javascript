import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  detectErrorsStack,
  ErrorsStackDetectionError,
} from "../commands/init/detect-errors";

let cwd: string;

function writePackage(
  root: string,
  dependencies: Record<string, string>,
  extra: Record<string, unknown> = {},
): void {
  mkdirSync(root, { recursive: true });
  writeFileSync(
    join(root, "package.json"),
    `${JSON.stringify({ name: "fixture", dependencies, ...extra }, null, 2)}\n`,
  );
}

function writeInstalledPackage(name: string, version: string): void {
  const root = join(cwd, "node_modules", ...name.split("/"));
  mkdirSync(root, { recursive: true });
  writeFileSync(
    join(root, "package.json"),
    `${JSON.stringify({ name, version }, null, 2)}\n`,
  );
}

function writeNuxtFixture(
  config = "nuxt.config.ts",
  node = "24.19.0",
  source = "export default defineNuxtConfig({ nitro: { preset: 'node-server' } });\n",
): void {
  writePackage(
    cwd,
    {
      nuxt: "4.5.2",
      vue: "3.5.42",
      "vue-router": "5.2.0",
    },
    {
      type: "module",
      engines: { node },
      scripts: { build: "nuxt build" },
    },
  );
  writeFileSync(join(cwd, ".node-version"), `${node}\n`);
  mkdirSync(join(cwd, "app"), { recursive: true });
  writeFileSync(join(cwd, "app", "app.vue"), "<template><NuxtPage /></template>\n");
  writeFileSync(join(cwd, config), source);
  for (const [name, version] of [
    ["nuxt", "4.5.2"],
    ["@nuxt/nitro-server", "4.5.2"],
    ["@nuxt/vite-builder", "4.5.2"],
    ["nitropack", "2.13.4"],
    ["vue", "3.5.42"],
    ["vue-router", "5.2.0"],
    ["vite", "8.2.2"],
  ] as const) {
    writeInstalledPackage(name, version);
  }
}

function writeSvelteKitFixture(
  config = "vite.config.ts",
  node = "24.19.0",
  source = [
    "import adapter from '@sveltejs/adapter-node';",
    "import { sveltekit } from '@sveltejs/kit/vite';",
    "import { defineConfig } from 'vite';",
    "export default defineConfig({ plugins: [sveltekit({ adapter: adapter() })] });",
    "",
  ].join("\n"),
): void {
  writePackage(
    cwd,
    {
      svelte: "5.56.10",
      "@sveltejs/kit": "2.70.3",
      "@sveltejs/adapter-node": "5.5.7",
      "@sveltejs/vite-plugin-svelte": "7.3.0",
      vite: "8.2.2",
    },
    {
      type: "module",
      engines: { node },
      scripts: { build: "vite build" },
    },
  );
  writeFileSync(join(cwd, ".node-version"), `${node}\n`);
  mkdirSync(join(cwd, "src", "routes"), { recursive: true });
  writeFileSync(join(cwd, "src", "routes", "+page.svelte"), "<h1>Ready</h1>\n");
  writeFileSync(join(cwd, config), source);
  for (const [name, version] of [
    ["svelte", "5.56.10"],
    ["@sveltejs/kit", "2.70.3"],
    ["@sveltejs/adapter-node", "5.5.7"],
    ["@sveltejs/vite-plugin-svelte", "7.3.0"],
    ["vite", "8.2.2"],
  ] as const) {
    writeInstalledPackage(name, version);
  }
}

function snapshot(root: string): Record<string, string> {
  const entries: Record<string, string> = {};
  const visit = (directory: string): void => {
    for (const name of readdirSync(directory).sort()) {
      const path = join(directory, name);
      if (statSync(path).isDirectory()) visit(path);
      else {
        entries[relative(root, path).replaceAll("\\", "/")] =
          readFileSync(path).toString("base64");
      }
    }
  };
  visit(root);
  return entries;
}

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), "volato-errors-detect-"));
});

afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
});

describe("detectErrorsStack", () => {
  it.each([
    ["vite.config.ts", "ts", "22.23.2"],
    ["vite.config.js", "js", "24.19.0"],
  ] as const)(
    "selects the private SvelteKit recipe before Vite + Svelte for %s",
    (config, language, node) => {
      writeSvelteKitFixture(config, node);

      const result = detectErrorsStack(cwd);

      expect(result.sveltekit).toEqual({
        cwd,
        configPath: join(cwd, config),
        language,
        nodeVersion: node,
        svelteVersion: "5.56.10",
        kitVersion: "2.70.3",
        adapterNodeVersion: "5.5.7",
        vitePluginVersion: "7.3.0",
        viteVersion: "8.2.2",
        clientHooksPath: join(cwd, "src", `hooks.client.${language}`),
        serverHooksPath: join(cwd, "src", `hooks.server.${language}`),
        outputRoot: join(cwd, "build"),
        intermediateOutputRoot: join(cwd, ".svelte-kit", "output"),
      });
      expect(result.browserSvelte).toBeUndefined();
      expect(result.node).toBeUndefined();
    },
  );

  it("resolves the exact Svelte Vite plugin when package exports hide package.json", () => {
    writeSvelteKitFixture();
    const pluginRoot = join(
      cwd,
      "node_modules",
      "@sveltejs",
      "vite-plugin-svelte",
    );
    writeFileSync(
      join(pluginRoot, "package.json"),
      `${JSON.stringify({
        name: "@sveltejs/vite-plugin-svelte",
        version: "7.3.0",
        type: "module",
        exports: { ".": "./index.js" },
      })}\n`,
    );
    writeFileSync(join(pluginRoot, "index.js"), "export {};\n");

    expect(detectErrorsStack(cwd).sveltekit?.vitePluginVersion).toBe("7.3.0");
  });

  it.each([
    [
      "SvelteKit version drift",
      () => {
        writeSvelteKitFixture();
        const pkg = JSON.parse(readFileSync(join(cwd, "package.json"), "utf8"));
        pkg.dependencies["@sveltejs/kit"] = "2.69.0";
        writeFileSync(join(cwd, "package.json"), `${JSON.stringify(pkg, null, 2)}\n`);
      },
      /SvelteKit 2\.69\.0.*frozen 2\.70\.3 calibration.*no files were modified/i,
    ],
    [
      "installed adapter drift",
      () => {
        writeSvelteKitFixture();
        writeInstalledPackage("@sveltejs/adapter-node", "5.6.0");
      },
      /adapter-node 5\.6\.0.*requires 5\.5\.7.*no files were modified/i,
    ],
    [
      "adapter-auto",
      () => {
        writeSvelteKitFixture();
        const pkg = JSON.parse(readFileSync(join(cwd, "package.json"), "utf8"));
        delete pkg.dependencies["@sveltejs/adapter-node"];
        pkg.dependencies["@sveltejs/adapter-auto"] = "6.1.0";
        writeFileSync(join(cwd, "package.json"), `${JSON.stringify(pkg, null, 2)}\n`);
      },
      /official adapter-node.*adapter-auto.*no files were modified/i,
    ],
    [
      "adapter options",
      () => writeSvelteKitFixture(
        "vite.config.ts",
        "24.19.0",
        "import adapter from '@sveltejs/adapter-node';\nimport { sveltekit } from '@sveltejs/kit/vite';\nimport { defineConfig } from 'vite';\nexport default defineConfig({ plugins: [sveltekit({ adapter: adapter({ out: 'dist' }) })] });\n",
      ),
      /optionless adapter-node.*no files were modified/i,
    ],
    [
      "legacy Svelte config",
      () => {
        writeSvelteKitFixture();
        writeFileSync(join(cwd, "svelte.config.js"), "export default {};\n");
      },
      /legacy svelte\.config.*no files were modified/i,
    ],
    [
      "dynamic Vite config",
      () => writeSvelteKitFixture(
        "vite.config.ts",
        "24.19.0",
        "import adapter from '@sveltejs/adapter-node';\nimport { sveltekit } from '@sveltejs/kit/vite';\nimport { defineConfig } from 'vite';\nconst config = { plugins: [sveltekit({ adapter: adapter() })] };\nexport default defineConfig(config);\n",
      ),
      /one static defineConfig object.*no files were modified/i,
    ],
    [
      "SSR disabled",
      () => writeSvelteKitFixture(
        "vite.config.ts",
        "24.19.0",
        "import adapter from '@sveltejs/adapter-node';\nimport { sveltekit } from '@sveltejs/kit/vite';\nimport { defineConfig } from 'vite';\nexport default defineConfig({ plugins: [sveltekit({ adapter: adapter(), ssr: false })] });\n",
      ),
      /ssr: false.*outside.*no files were modified/i,
    ],
    [
      "experimental rendering handler",
      () => writeSvelteKitFixture(
        "vite.config.ts",
        "24.19.0",
        "import adapter from '@sveltejs/adapter-node';\nimport { sveltekit } from '@sveltejs/kit/vite';\nimport { defineConfig } from 'vite';\nexport default defineConfig({ plugins: [sveltekit({ adapter: adapter(), experimental: { handleRenderingErrors: true } })] });\n",
      ),
      /handleRenderingErrors.*outside.*no files were modified/i,
    ],
    [
      "service worker",
      () => {
        writeSvelteKitFixture();
        writeFileSync(join(cwd, "src", "service-worker.ts"), "self.addEventListener('install', () => {});\n");
      },
      /service workers.*outside.*no files were modified/i,
    ],
    [
      "remote function",
      () => {
        writeSvelteKitFixture();
        writeFileSync(join(cwd, "src", "account.remote.ts"), "export const account = {};\n");
      },
      /remote functions.*outside.*no files were modified/i,
    ],
    [
      "Bun runtime marker",
      () => {
        writeSvelteKitFixture();
        writeFileSync(join(cwd, "bun.lock"), "");
      },
      /Bun and Deno.*outside.*no files were modified/i,
    ],
  ] as const)(
    "refuses %s before falling back to the Svelte SPA recipe",
    (_label, arrange, expected) => {
      arrange();
      const before = snapshot(cwd);

      expect(() => detectErrorsStack(cwd)).toThrowError(expected);
      expect(snapshot(cwd)).toEqual(before);
    },
  );

  it.each([
    ["nuxt.config.ts", "ts", "22.23.2"],
    ["nuxt.config.js", "js", "24.19.0"],
    ["nuxt.config.mjs", "mjs", "24.19.0"],
  ] as const)(
    "selects the private Nuxt recipe before Vite + Vue for %s",
    (config, format, node) => {
      writeNuxtFixture(config, node);

      const result = detectErrorsStack(cwd);

      expect(result.nuxt).toEqual({
        cwd,
        configPath: join(cwd, config),
        configFormat: format,
        language: format === "ts" ? "ts" : "js",
        nodeVersion: node,
        nuxtVersion: "4.5.2",
        nitroVersion: "2.13.4",
        vueVersion: "3.5.42",
        viteVersion: "8.2.2",
        outputRoot: join(cwd, ".output"),
      });
      expect(result.browserVue).toBeUndefined();
      expect(result.node).toBeUndefined();
    },
  );

  it.each([
    [
      "Nuxt 3",
      () => {
        writeNuxtFixture();
        const pkg = JSON.parse(readFileSync(join(cwd, "package.json"), "utf8"));
        pkg.dependencies.nuxt = "3.20.1";
        writeFileSync(join(cwd, "package.json"), `${JSON.stringify(pkg, null, 2)}\n`);
      },
      /Nuxt 3\.20\.1.*frozen 4\.5\.2 calibration.*no files were modified/i,
    ],
    [
      "SSR disabled",
      () => writeNuxtFixture("nuxt.config.ts", "24.19.0", "export default defineNuxtConfig({ ssr: false, nitro: { preset: 'node-server' } });\n"),
      /ssr: false.*not supported.*no files were modified/i,
    ],
    [
      "provider preset",
      () => writeNuxtFixture("nuxt.config.ts", "24.19.0", "export default defineNuxtConfig({ nitro: { preset: 'cloudflare-pages' } });\n"),
      /node-server preset.*cloudflare-pages.*no files were modified/i,
    ],
    [
      "route rules",
      () => writeNuxtFixture("nuxt.config.ts", "24.19.0", "export default defineNuxtConfig({ routeRules: { '/admin/**': { ssr: false } }, nitro: { preset: 'node-server' } });\n"),
      /route rules.*hybrid.*no files were modified/i,
    ],
    [
      "layer",
      () => writeNuxtFixture("nuxt.config.ts", "24.19.0", "export default defineNuxtConfig({ extends: ['./base'], nitro: { preset: 'node-server' } });\n"),
      /layers.*not supported.*no files were modified/i,
    ],
    [
      "custom builder",
      () => writeNuxtFixture("nuxt.config.ts", "24.19.0", "export default defineNuxtConfig({ builder: 'rspack', nitro: { preset: 'node-server' } });\n"),
      /default Vite builder.*no files were modified/i,
    ],
    [
      "dynamic config",
      () => writeNuxtFixture("nuxt.config.ts", "24.19.0", "export default async () => defineNuxtConfig({ nitro: { preset: 'node-server' } });\n"),
      /static defineNuxtConfig.*no files were modified/i,
    ],
    [
      "dynamic Vite config",
      () => writeNuxtFixture("nuxt.config.ts", "24.19.0", "const vite = () => ({});\nexport default defineNuxtConfig({ vite, nitro: { preset: 'node-server' } });\n"),
      /Vite configuration.*static object.*no files were modified/i,
    ],
    [
      "non-object sourcemap config",
      () => writeNuxtFixture("nuxt.config.ts", "24.19.0", "export default defineNuxtConfig({ sourcemap: true, nitro: { preset: 'node-server' } });\n"),
      /sourcemap configuration.*static object.*no files were modified/i,
    ],
    [
      "islands",
      () => writeNuxtFixture("nuxt.config.ts", "24.19.0", "export default defineNuxtConfig({ experimental: { componentIslands: true }, nitro: { preset: 'node-server' } });\n"),
      /islands.*outside.*no files were modified/i,
    ],
    [
      "custom output directory",
      () => writeNuxtFixture("nuxt.config.ts", "24.19.0", "export default defineNuxtConfig({ nitro: { preset: 'node-server', output: { dir: './dist' } } });\n"),
      /custom build or output directories.*no files were modified/i,
    ],
    [
      "Bun runtime marker",
      () => {
        writeNuxtFixture();
        writeFileSync(join(cwd, "bun.lock"), "");
      },
      /Bun and Deno.*outside.*no files were modified/i,
    ],
  ] as const)("refuses %s before falling back to Vue", (_label, arrange, expected) => {
    arrange();
    const before = snapshot(cwd);

    expect(() => detectErrorsStack(cwd)).toThrowError(expected);
    expect(snapshot(cwd)).toEqual(before);
  });

  it("refuses a drifted installed Nuxt tuple", () => {
    writeNuxtFixture();
    writeInstalledPackage("nitropack", "2.14.0");

    expect(() => detectErrorsStack(cwd)).toThrowError(
      /Nitro 2\.14\.0.*requires 2\.13\.4.*no files were modified/i,
    );
  });

  it("redetects the generated Nuxt wrapper for convergent setup", () => {
    writeNuxtFixture(
      "nuxt.config.ts",
      "24.19.0",
      "import { withVolatoNuxt } from './volato-nuxt/build.mjs';\nexport default withVolatoNuxt(defineNuxtConfig({ nitro: { preset: 'node-server' } }));\n",
    );
    const pkg = JSON.parse(readFileSync(join(cwd, "package.json"), "utf8"));
    pkg.scripts.build =
      "nuxt build && node volato-nuxt/upload-sourcemaps.mjs .output";
    writeFileSync(join(cwd, "package.json"), `${JSON.stringify(pkg, null, 2)}\n`);

    expect(detectErrorsStack(cwd).nuxt).toMatchObject({
      configPath: join(cwd, "nuxt.config.ts"),
      configFormat: "ts",
    });
  });

  it("refuses an unowned Nuxt build wrapper before mutation", () => {
    writeNuxtFixture(
      "nuxt.config.ts",
      "24.19.0",
      "import { withVolatoNuxt } from './custom-build.mjs';\nexport default withVolatoNuxt(defineNuxtConfig({ nitro: { preset: 'node-server' } }));\n",
    );
    const before = snapshot(cwd);

    expect(() => detectErrorsStack(cwd)).toThrowError(
      /wrapper.*generated build helper.*no files were modified/i,
    );
    expect(snapshot(cwd)).toEqual(before);
  });

  it.each([
    [
      "async handler",
      "src/handler.ts",
      "module",
      'export const handler = async (input: unknown) => ({ input });\n',
      "async-handler",
      "ts",
      "esm",
    ],
    [
      "Node HTTP handler",
      "handler.js",
      "commonjs",
      'exports.handler = async (req, res) => { res.end("ok"); };\n',
      "node-http-handler",
      "js",
      "cjs",
    ],
  ] as const)(
    "detects one provider-neutral %s",
    (_label, entry, packageType, source, handlerShape, language, module) => {
      writePackage(cwd, {}, { type: packageType });
      mkdirSync(join(cwd, "src"), { recursive: true });
      writeFileSync(join(cwd, entry), source);

      expect(detectErrorsStack(cwd).nodeInvocation).toMatchObject({
        handlerPath: join(cwd, entry),
        handlerShape,
        language,
        module,
      });
    },
  );

  it.each([
    [
      "callback",
      "exports.handler = (event, context, callback) => callback(null, event);\n",
      /callback-style.*outside the promise.*no files were modified/i,
    ],
    [
      "synchronous",
      "exports.handler = (event) => ({ event });\n",
      /synchronous.*promise-returning asynchronous handler.*no files were modified/i,
    ],
    [
      "streaming",
      "exports.handler = async (_req, res) => { res.write('chunk'); res.end(); };\n",
      /streaming response completion.*outside the promise.*no files were modified/i,
    ],
  ])("refuses a %s invocation before mutation", (_label, source, expected) => {
    writePackage(cwd, {}, { type: "commonjs" });
    writeFileSync(join(cwd, "handler.js"), source);

    expect(() => detectErrorsStack(cwd)).toThrowError(expected);
  });

  it("detects a conventional NestJS 11 HTTP application on Express 5", () => {
    writePackage(
      cwd,
      {
        "@nestjs/common": "11.1.17",
        "@nestjs/core": "11.1.17",
        "@nestjs/platform-express": "11.1.17",
        express: "5.2.1",
      },
      { type: "commonjs", scripts: { build: "nest build" } },
    );
    mkdirSync(join(cwd, "src"));
    writeFileSync(
      join(cwd, "src", "main.ts"),
      'import { NestFactory } from "@nestjs/core";\nimport { AppModule } from "./app.module";\nasync function bootstrap() {\n  const app = await NestFactory.create(AppModule);\n  await app.listen(3000);\n}\nvoid bootstrap();\n',
    );

    expect(detectErrorsStack(cwd).nest).toMatchObject({
      entryPath: join(cwd, "src", "main.ts"),
      appVariable: "app",
      nestVersion: 11,
      transport: "express",
      transportVersion: 5,
      language: "ts",
      module: "cjs",
    });
    expect(detectErrorsStack(cwd).node).toBeUndefined();
    expect(detectErrorsStack(cwd).fastify).toBeUndefined();
  });

  it("detects a conventional NestJS 12 HTTP application on Fastify 5", () => {
    writePackage(cwd, {
      "@nestjs/common": "12.0.1",
      "@nestjs/core": "12.0.1",
      "@nestjs/platform-fastify": "12.0.1",
      fastify: "5.12.1",
    });
    mkdirSync(join(cwd, "src"));
    writeFileSync(
      join(cwd, "src", "main.ts"),
      'import { NestFactory } from "@nestjs/core";\nimport { FastifyAdapter } from "@nestjs/platform-fastify";\nasync function bootstrap() {\n  const app = await NestFactory.create(AppModule, new FastifyAdapter());\n  await app.listen(3000);\n}\nvoid bootstrap();\n',
    );

    expect(detectErrorsStack(cwd).nest).toMatchObject({
      nestVersion: 12,
      transport: "fastify",
      transportVersion: 5,
    });
  });

  it.each([
    ["NestJS 10", { "@nestjs/core": "10.4.22", "@nestjs/common": "10.4.22" }, "const app = await NestFactory.create(AppModule);", /NestJS 10.*not supported/i],
    ["GraphQL", { "@nestjs/core": "11.2.3", "@nestjs/common": "11.2.3", "@nestjs/graphql": "13.2.3" }, "const app = await NestFactory.create(AppModule);", /NestJS GraphQL.*not supported/i],
    ["a custom adapter", { "@nestjs/core": "11.2.3", "@nestjs/common": "11.2.3" }, "const app = await NestFactory.create(AppModule, new CustomAdapter());", /custom HTTP adapter.*no files were modified/i],
    ["an existing global filter", { "@nestjs/core": "11.2.3", "@nestjs/common": "11.2.3" }, "const app = await NestFactory.create(AppModule);\n  app.useGlobalFilters(new ExistingFilter());", /existing NestJS exception filter.*no files were modified/i],
    ["multiple applications", { "@nestjs/core": "11.2.3", "@nestjs/common": "11.2.3" }, "const app = await NestFactory.create(AppModule);\n  const admin = await NestFactory.create(AdminModule);", /exactly one NestFactory\.create.*no files were modified/i],
  ])("refuses %s before selecting the NestJS recipe", (_label, dependencies, body, expected) => {
    writePackage(cwd, dependencies, { type: "commonjs" });
    mkdirSync(join(cwd, "src"));
    writeFileSync(
      join(cwd, "src", "main.ts"),
      `import { NestFactory } from "@nestjs/core";\nasync function bootstrap() {\n  ${body}\n  await app.listen(3000);\n}\nvoid bootstrap();\n`,
    );

    expect(() => detectErrorsStack(cwd)).toThrowError(expected);
  });

  it("detects one conventional Vite + Svelte 5 application", () => {
    writePackage(cwd, {
      vite: "8.2.2",
      svelte: "5.56.10",
      "@sveltejs/vite-plugin-svelte": "7.3.0",
    });
    mkdirSync(join(cwd, "src"));
    writeFileSync(
      join(cwd, "src", "main.js"),
      'import { mount } from "svelte";\nimport App from "./App.svelte";\nconst app = mount(App, { target: document.getElementById("app") });\nexport default app;\n',
    );
    writeFileSync(join(cwd, "src", "App.svelte"), "<main>Ready</main>\n");
    writeFileSync(join(cwd, "vite.config.js"), "export default defineConfig({});\n");

    expect(detectErrorsStack(cwd).browserSvelte).toMatchObject({
      entryPath: join(cwd, "src", "main.js"),
      rootComponentPath: join(cwd, "src", "App.svelte"),
      rootComponentVariable: "App",
      buildAdapter: "vite",
      language: "js",
    });
  });

  it.each([
    ["Svelte 4", { svelte: "4.2.20" }, 'mount(App, { target })', "<main />", /Svelte 4.*not supported/i],
    ["SvelteKit", { svelte: "5.56.10", "@sveltejs/kit": "2.48.5" }, 'mount(App, { target })', "<main />", /SvelteKit.*not supported/i],
    ["hydrate", { svelte: "5.56.10" }, 'hydrate(App, { target })', "<main />", /hydrate.*not supported/i],
    ["existing boundary", { svelte: "5.56.10" }, 'mount(App, { target })', "<svelte:boundary><Widget /></svelte:boundary>", /existing Svelte boundary.*no files were modified/i],
    ["exported component API", { svelte: "5.56.10" }, 'mount(App, { target })', "<script>export const ping = () => true;</script>\n<main />", /exported Svelte component API.*no files were modified/i],
  ])(
    "refuses %s before selecting the Svelte recipe",
    (_label, renderer, mountSource, appSource, expected) => {
      writePackage(cwd, {
        vite: "8.2.2",
        "@sveltejs/vite-plugin-svelte": "7.3.0",
        ...renderer,
      });
      mkdirSync(join(cwd, "src"));
      writeFileSync(
        join(cwd, "src", "main.js"),
        `import { mount, hydrate } from "svelte";\nimport App from "./App.svelte";\n${mountSource};\n`,
      );
      writeFileSync(join(cwd, "src", "App.svelte"), `${appSource}\n`);
      writeFileSync(join(cwd, "vite.config.js"), "export default defineConfig({});\n");

      expect(() => detectErrorsStack(cwd)).toThrowError(expected);
    },
  );

  it("refuses multiple conventional invocation entries", () => {
    writePackage(cwd, {}, { type: "module" });
    mkdirSync(join(cwd, "src"));
    writeFileSync(
      join(cwd, "src", "handler.ts"),
      "export const handler = async () => 'src';\n",
    );
    writeFileSync(
      join(cwd, "handler.ts"),
      "export const handler = async () => 'root';\n",
    );

    expect(() => detectErrorsStack(cwd)).toThrowError(
      /multiple conventional Node invocation entries.*no files were modified/i,
    );
  });

  it.each([
    [
      "async-handler",
      'import { withVolatoInvocation } from "./volato-invocation/invocation.js";\nconst volatoOriginalHandler = async (input) => input;\nexport const handler = withVolatoInvocation(volatoOriginalHandler, { functionName: "handler" });\n',
    ],
    [
      "node-http-handler",
      'const { withVolatoInvocation } = require("./volato-invocation/invocation.cjs");\nconst volatoOriginalHandler = async (req, res) => res.end();\nexports.handler = withVolatoInvocation(volatoOriginalHandler, { functionName: "handler", http: true });\n',
    ],
  ] as const)(
    "redetects a generated %s composition for convergent setup",
    (handlerShape, source) => {
      writePackage(cwd, {}, { type: handlerShape === "async-handler" ? "module" : "commonjs" });
      writeFileSync(join(cwd, "handler.js"), source);

      expect(detectErrorsStack(cwd).nodeInvocation).toMatchObject({ handlerShape });
    },
  );

  it.each([
    ["server", "src/server.ts", "module", "ts", "esm"],
    ["job", "src/job.js", "commonjs", "js", "cjs"],
    ["script", "src/index.ts", "commonjs", "ts", "cjs"],
  ] as const)(
    "detects one conventional %s entry with its language and module format",
    (processShape, entry, packageType, language, module) => {
      writePackage(cwd, {}, { type: packageType });
      mkdirSync(join(cwd, "src"));
      writeFileSync(join(cwd, entry), "export const fixture = true;\n");

      expect(detectErrorsStack(cwd).node).toMatchObject({
        entryPath: join(cwd, entry),
        processShape,
        language,
        module,
      });
    },
  );

  it("refuses ambiguous conventional Node entries instead of selecting the first", () => {
    writePackage(cwd, {}, { type: "module" });
    mkdirSync(join(cwd, "src"));
    writeFileSync(join(cwd, "src", "server.js"), "startServer();\n");
    writeFileSync(join(cwd, "src", "job.js"), "runJob();\n");

    expect(() => detectErrorsStack(cwd)).toThrowError(
      /multiple conventional Node entries.*src\/server\.js.*src\/job\.js.*no files were modified/i,
    );
  });

  it("detects an Express 5 same-file server topology", () => {
    writePackage(
      cwd,
      { express: "5.2.1" },
      { type: "module" },
    );
    mkdirSync(join(cwd, "src"));
    writeFileSync(
      join(cwd, "src", "server.ts"),
      'import express from "express";\nconst app = express();\napp.get("/", route);\napp.listen(3000);\n',
    );

    expect(detectErrorsStack(cwd).node).toMatchObject({
      express: true,
      expressVersion: 5,
      expressTopology: "same-file",
      expressAppPath: join(cwd, "src", "server.ts"),
    });
  });

  it("detects an Express 4 split CommonJS bootstrap topology", () => {
    writePackage(
      cwd,
      { express: "4.22.2" },
      { type: "commonjs" },
    );
    mkdirSync(join(cwd, "src"));
    writeFileSync(
      join(cwd, "src", "server.js"),
      'const app = require("./app");\napp.listen(3000);\n',
    );
    writeFileSync(
      join(cwd, "src", "app.js"),
      'const express = require("express");\nconst app = express();\napp.get("/", route);\nmodule.exports = app;\n',
    );

    expect(detectErrorsStack(cwd).node).toMatchObject({
      express: true,
      expressVersion: 4,
      expressTopology: "split-bootstrap",
      expressAppPath: join(cwd, "src", "app.js"),
    });
  });

  it("detects a Fastify 5 same-file server topology", () => {
    writePackage(
      cwd,
      { fastify: "5.12.1" },
      { type: "module", scripts: { build: "tsc --sourceMap" } },
    );
    mkdirSync(join(cwd, "src"));
    writeFileSync(
      join(cwd, "src", "server.ts"),
      'import Fastify from "fastify";\nconst app = Fastify();\napp.get("/health", async () => ({ ok: true }));\nawait app.listen({ port: 3000 });\n',
    );

    expect(detectErrorsStack(cwd).fastify).toMatchObject({
      entryPath: join(cwd, "src", "server.ts"),
      appPath: join(cwd, "src", "server.ts"),
      appVariable: "app",
      topology: "same-file",
      fastifyVersion: 5,
      language: "ts",
      module: "esm",
    });
    expect(detectErrorsStack(cwd).node).toBeUndefined();
  });

  it("detects a Fastify 5 split CommonJS bootstrap topology", () => {
    writePackage(cwd, { fastify: "5.12.1" }, { type: "commonjs" });
    mkdirSync(join(cwd, "src"));
    writeFileSync(
      join(cwd, "src", "server.js"),
      'const app = require("./app");\napp.listen({ port: 3000 });\n',
    );
    writeFileSync(
      join(cwd, "src", "app.js"),
      'const Fastify = require("fastify");\nconst app = Fastify();\nmodule.exports = app;\n',
    );

    expect(detectErrorsStack(cwd).fastify).toMatchObject({
      entryPath: join(cwd, "src", "server.js"),
      appPath: join(cwd, "src", "app.js"),
      appVariable: "app",
      topology: "split-bootstrap",
      language: "js",
      module: "cjs",
    });
  });

  it.each([
    ["Fastify 4", "4.29.1", /Fastify 4.*not supported/i],
    ["an unsupported major", "6.0.0", /Fastify 6.*not supported/i],
  ])("refuses %s before mutation", (_label, version, expected) => {
    writePackage(cwd, { fastify: version }, { type: "module" });
    writeFileSync(
      join(cwd, "server.js"),
      'import Fastify from "fastify";\nconst app = Fastify();\napp.listen({ port: 3000 });\n',
    );

    expect(() => detectErrorsStack(cwd)).toThrowError(expected);
  });

  it("keeps generic Node capture when the installed Express major is unsupported", () => {
    writePackage(
      cwd,
      { express: "6.0.0" },
      { type: "module" },
    );
    mkdirSync(join(cwd, "src"));
    writeFileSync(
      join(cwd, "src", "server.js"),
      'const app = express();\napp.listen(3000);\n',
    );

    const result = detectErrorsStack(cwd);
    expect(result.node).toMatchObject({ express: false });
    expect(result.notices).toContainEqual(
      expect.stringMatching(/Express 6.*not supported.*generic Node/i),
    );
  });

  it("does not guess between same-file and split Express app ownership", () => {
    writePackage(cwd, { express: "5.2.1" }, { type: "module" });
    mkdirSync(join(cwd, "src"));
    writeFileSync(
      join(cwd, "src", "server.ts"),
      'const app = express();\napp.listen(3000);\n',
    );
    writeFileSync(
      join(cwd, "src", "app.ts"),
      'const app = express();\nexport default app;\n',
    );

    const result = detectErrorsStack(cwd);
    expect(result.node).toMatchObject({ express: false });
    expect(result.notices).toContainEqual(
      expect.stringMatching(/same-file or split.*could not be identified.*generic Node/i),
    );
  });

  it("detects Vite + React and Express independently in one application", () => {
    writePackage(cwd, {
      express: "^5.1.0",
      react: "^19.1.1",
      "react-dom": "^19.1.1",
      vite: "^7.1.1",
    });
    mkdirSync(join(cwd, "src"));
    writeFileSync(join(cwd, "src", "main.tsx"), "createRoot(root).render(<App />);\n");
    writeFileSync(join(cwd, "src", "server.ts"), "const app = express();\napp.listen(3000);\n");
    writeFileSync(join(cwd, "vite.config.ts"), "export default defineConfig({});\n");

    const result = detectErrorsStack(cwd);

    expect(result.nextjs).toBeUndefined();
    expect(result.viteReact).toMatchObject({
      entryPath: join(cwd, "src", "main.tsx"),
      viteConfigPath: join(cwd, "vite.config.ts"),
      language: "ts",
    });
    expect(result.node).toMatchObject({
      entryPath: join(cwd, "src", "server.ts"),
      express: true,
      language: "ts",
    });
  });

  it("does not infer a Node server from a Vite-only frontend toolchain", () => {
    writePackage(cwd, {
      react: "^19.1.1",
      "react-dom": "^19.1.1",
      vite: "^7.1.1",
    });
    mkdirSync(join(cwd, "src"));
    writeFileSync(join(cwd, "src", "main.jsx"), "createRoot(root).render(<App />);\n");
    writeFileSync(join(cwd, "vite.config.js"), "export default defineConfig({});\n");

    const result = detectErrorsStack(cwd);

    expect(result.viteReact?.language).toBe("js");
    expect(result.node).toBeUndefined();
  });

  it.each([
    [
      "Webpack",
      { react: "19.2.8", "react-dom": "19.2.8", webpack: "5.109.2" },
      "webpack.config.cjs",
      "module.exports = {};\n",
      "webpack",
    ],
    [
      "Rspack",
      {
        react: "19.2.8",
        "react-dom": "19.2.8",
        "@rspack/core": "2.2.0",
        "@rspack/cli": "2.2.0",
      },
      "rspack.config.ts",
      "export default {};\n",
      "rspack",
    ],
  ])(
    "detects React with the %s build adapter",
    (_label, dependencies, configName, configSource, adapter) => {
      writePackage(cwd, dependencies);
      mkdirSync(join(cwd, "src"));
      writeFileSync(join(cwd, "src", "main.tsx"), "createRoot(root).render(<App />);\n");
      writeFileSync(join(cwd, configName), configSource);

      expect(detectErrorsStack(cwd).browserReact).toMatchObject({
        entryPath: join(cwd, "src", "main.tsx"),
        buildConfigPath: join(cwd, configName),
        buildAdapter: adapter,
        language: "ts",
      });
    },
  );

  it("refuses ambiguous browser build targets before selecting an adapter", () => {
    writePackage(cwd, {
      react: "19.2.8",
      "react-dom": "19.2.8",
      vite: "8.2.2",
      webpack: "5.109.2",
    });
    mkdirSync(join(cwd, "src"));
    writeFileSync(join(cwd, "src", "main.tsx"), "createRoot(root).render(<App />);\n");
    writeFileSync(join(cwd, "vite.config.ts"), "export default {};\n");
    writeFileSync(join(cwd, "webpack.config.mjs"), "export default {};\n");

    expect(() => detectErrorsStack(cwd)).toThrowError(
      /multiple browser build configurations.*no files were modified/i,
    );
  });

  it("detects one conventional Vite + Vue 3 application", () => {
    writePackage(cwd, {
      vite: "7.3.6",
      vue: "3.5.42",
      "@vitejs/plugin-vue": "6.0.8",
    });
    mkdirSync(join(cwd, "src"));
    writeFileSync(
      join(cwd, "src", "main.ts"),
      'import { createApp } from "vue";\nimport App from "./App.vue";\nconst app = createApp(App);\napp.mount("#app");\n',
    );
    writeFileSync(join(cwd, "src", "App.vue"), "<template><main>Ready</main></template>\n");
    writeFileSync(join(cwd, "vite.config.ts"), "export default defineConfig({});\n");

    expect(detectErrorsStack(cwd).browserVue).toMatchObject({
      entryPath: join(cwd, "src", "main.ts"),
      buildConfigPath: join(cwd, "vite.config.ts"),
      buildAdapter: "vite",
      language: "ts",
    });
  });

  it.each([
    ["Vue 2", { vue: "2.7.16" }, 'createApp(App).mount("#app")', /Vue 2.*not supported/i],
    ["SSR", { vue: "3.5.42" }, 'createSSRApp(App).mount("#app")', /createSSRApp.*not supported/i],
    ["multiple roots", { vue: "3.5.42" }, 'createApp(App).mount("#one");\ncreateApp(Admin).mount("#two");', /exactly one.*createApp.*no files were modified/i],
    ["Nuxt", { vue: "3.5.42", nuxt: "4.1.2" }, 'createApp(App).mount("#app")', /Nuxt.*not supported/i],
    ["a chained root", { vue: "3.5.42" }, 'createApp(App).mount("#app")', /named createApp root.*no files were modified/i],
  ])("refuses %s before selecting the Vue recipe", (_label, renderer, source, expected) => {
    writePackage(cwd, { vite: "7.3.6", "@vitejs/plugin-vue": "6.0.8", ...renderer });
    mkdirSync(join(cwd, "src"));
    writeFileSync(join(cwd, "src", "main.ts"), `${source}\n`);
    writeFileSync(join(cwd, "vite.config.ts"), "export default defineConfig({});\n");

    expect(() => detectErrorsStack(cwd)).toThrowError(expected);
  });

  it.each([
    ["Python", join("backend", "pyproject.toml")],
    ["Go", join("backend", "go.mod")],
    ["PHP", join("backend", "composer.json")],
  ])(
    "keeps Vite browser coverage explicit when a %s backend is unsupported",
    (backend, manifest) => {
      writePackage(cwd, {
        react: "^19.1.1",
        "react-dom": "^19.1.1",
        vite: "^7.1.1",
      });
      mkdirSync(join(cwd, "src"));
      mkdirSync(join(cwd, "backend"));
      writeFileSync(join(cwd, "src", "main.tsx"), "render(<App />);\n");
      writeFileSync(join(cwd, "vite.config.ts"), "export default {};\n");
      writeFileSync(join(cwd, manifest), "fixture\n");

      const result = detectErrorsStack(cwd);

      expect(result.viteReact).toBeDefined();
      expect(result.node).toBeUndefined();
      expect(result.notices).toContainEqual(
        expect.stringMatching(
          new RegExp(`${backend} backend.*not supported.*browser`, "i"),
        ),
      );
    },
  );

  it("refuses a Fastify dependency without one conventional server entry", () => {
    writePackage(cwd, {
      fastify: "^5.6.0",
      react: "^19.1.1",
      "react-dom": "^19.1.1",
      vite: "^7.1.1",
    });
    mkdirSync(join(cwd, "src"));
    writeFileSync(join(cwd, "src", "main.tsx"), "render(<App />);\n");
    writeFileSync(join(cwd, "src", "api.ts"), "startFastify();\n");
    writeFileSync(join(cwd, "vite.config.ts"), "export default {};\n");

    expect(() => detectErrorsStack(cwd)).toThrowError(
      /Fastify 5.*conventional server entry.*no files were modified/i,
    );
  });

  it("requires an explicit application root for an ambiguous monorepo", () => {
    writePackage(cwd, {}, { workspaces: ["apps/*"] });
    for (const name of ["web-a", "web-b"]) {
      const root = join(cwd, "apps", name);
      writePackage(root, { react: "^19.1.1", vite: "^7.1.1" });
      mkdirSync(join(root, "src"));
      writeFileSync(join(root, "src", "main.tsx"), "render(<App />);\n");
      writeFileSync(join(root, "vite.config.ts"), "export default {};\n");
    }

    expect(() => detectErrorsStack(cwd)).toThrowError(
      ErrorsStackDetectionError,
    );
    expect(() => detectErrorsStack(cwd)).toThrowError(
      /multiple supported applications.*run.*application root/i,
    );
  });
});
