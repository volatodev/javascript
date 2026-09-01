import { spawn, spawnSync } from "node:child_process";
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const scratch = mkdtempSync(join(tmpdir(), "volato-framework-agent-canaries-"));
const cliHost = join(scratch, "cli-host");
const authToken = "framework-agent-workspace-token";
const ingestToken = "framework-agent-ingest-token";

const targets = {
  vue: {
    label: "Vite + Vue 3",
    projectId: "10000000-0000-4000-8000-000000000201",
    groupId: "20000000-0000-4000-8000-000000000201",
    integrationId: "errors-browser-vue",
    skill: "volato-vite-vue",
    runtime: "browser",
    capturedVia: "vue_error_handler",
    route: "/:segment",
    language: "js",
    release: "2012012012012012012012012012012012012012",
  },
  svelte: {
    label: "Vite + Svelte 5",
    projectId: "10000000-0000-4000-8000-000000000202",
    groupId: "20000000-0000-4000-8000-000000000202",
    integrationId: "errors-browser-svelte",
    skill: "volato-vite-svelte",
    runtime: "browser",
    capturedVia: "svelte_boundary",
    route: "/:segment",
    language: "js",
    release: "2022022022022022022022022022022022022022",
  },
  fastify: {
    label: "Fastify 5",
    projectId: "10000000-0000-4000-8000-000000000203",
    groupId: "20000000-0000-4000-8000-000000000203",
    integrationId: "errors-node-fastify",
    skill: "volato-fastify",
    runtime: "node",
    capturedVia: "fastify",
    route: "/checkout",
    language: "ts",
    release: "2032032032032032032032032032032032032032",
  },
  nest: {
    label: "NestJS 12 HTTP on Fastify 5",
    projectId: "10000000-0000-4000-8000-000000000204",
    groupId: "20000000-0000-4000-8000-000000000204",
    integrationId: "errors-node-nestjs",
    skill: "volato-nestjs",
    runtime: "node",
    capturedVia: "nest_exception_filter",
    route: "/checkout",
    language: "ts",
    release: "2042042042042042042042042042042042042042",
  },
  angular: {
    label: "Angular 22 supported integration",
    projectId: "10000000-0000-4000-8000-000000000205",
    groupId: "20000000-0000-4000-8000-000000000205",
    integrationId: "errors-browser-angular",
    skill: "volato-angular",
    runtime: "browser",
    capturedVia: "angular_error_handler",
    route: "/:segment",
    language: "ts",
    release: "2052052052052052052052052052052052052052",
  },
  fastapi: {
    label: "FastAPI 0.141 supported integration",
    projectId: "10000000-0000-4000-8000-000000000206",
    groupId: "20000000-0000-4000-8000-000000000206",
    integrationId: "errors-python-fastapi",
    skill: "volato-fastapi",
    runtime: "python",
    capturedVia: "asgi_http",
    route: "/checkout",
    language: "py",
    release: "2062062062062062062062062062062062062062",
  },
  nuxt: {
    label: "Nuxt 4.5/Nitro 2.13 supported integration",
    projectId: "10000000-0000-4000-8000-000000000207",
    groupId: "20000000-0000-4000-8000-000000000207",
    integrationId: "errors-nuxt",
    skill: "volato-nuxt",
    runtime: "node",
    capturedVia: "nitro_error",
    route: "/checkout",
    language: "ts",
    release: "2072072072072072072072072072072072072072",
  },
  sveltekit: {
    label: "SvelteKit 2.70/adapter-node 5 supported integration",
    projectId: "10000000-0000-4000-8000-000000000208",
    groupId: "20000000-0000-4000-8000-000000000208",
    integrationId: "errors-sveltekit",
    skill: "volato-sveltekit",
    runtime: "node",
    capturedVia: "sveltekit_server_handle_error",
    route: "/checkout",
    language: "ts",
    release: "2082082082082082082082082082082082082082",
  },
  astroCore: {
    label: "Astro 7.2 standalone Node core supported integration",
    projectId: "10000000-0000-4000-8000-000000000209",
    groupId: "20000000-0000-4000-8000-000000000209",
    integrationId: "errors-astro",
    skill: "volato-astro",
    runtime: "node",
    capturedVia: "astro_middleware",
    route: "/checkout",
    language: "ts",
    astroRenderer: "core",
    release: "2092092092092092092092092092092092092092",
  },
  astroReact: {
    label: "Astro 7.2 + React 19 hydration supported integration",
    projectId: "10000000-0000-4000-8000-000000000210",
    groupId: "20000000-0000-4000-8000-000000000210",
    integrationId: "errors-astro",
    skill: "volato-astro",
    runtime: "node",
    capturedVia: "astro_middleware",
    route: "/checkout",
    language: "ts",
    astroRenderer: "react",
    release: "2102102102102102102102102102102102102102",
  },
  astroVue: {
    label: "Astro 7.2 + Vue 3 hydration supported integration",
    projectId: "10000000-0000-4000-8000-000000000211",
    groupId: "20000000-0000-4000-8000-000000000211",
    integrationId: "errors-astro",
    skill: "volato-astro",
    runtime: "node",
    capturedVia: "astro_middleware",
    route: "/checkout",
    language: "ts",
    astroRenderer: "vue",
    release: "2112112112112112112112112112112112112112",
  },
  astroSvelte: {
    label: "Astro 7.2 + Svelte 5 hydration supported integration",
    projectId: "10000000-0000-4000-8000-000000000212",
    groupId: "20000000-0000-4000-8000-000000000212",
    integrationId: "errors-astro",
    skill: "volato-astro",
    runtime: "node",
    capturedVia: "astro_middleware",
    route: "/checkout",
    language: "ts",
    astroRenderer: "svelte",
    release: "2122122122122122122122122122122122122122",
  },
};

function isAstroTarget(target) {
  return typeof target.astroRenderer === "string";
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? repositoryRoot,
    encoding: "utf8",
    env: { ...process.env, ...options.env, NO_COLOR: "1" },
    timeout: options.timeout ?? 60_000,
    maxBuffer: 40 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0 && !options.allowFailure) {
    throw new Error(
      `${command} ${args.join(" ")} failed (${result.status})\n${result.stdout}\n${result.stderr}`,
    );
  }
  return result;
}

function runAgent(root, prompt, env) {
  return new Promise((resolveResult) => {
    const child = spawn(
      "codex",
      [
        "exec",
        "--ephemeral",
        "--ignore-user-config",
        "--sandbox",
        "workspace-write",
        "--json",
        "-c",
        'shell_environment_policy.inherit="all"',
        "-c",
        "sandbox_workspace_write.network_access=true",
        "-C",
        root,
        prompt,
      ],
      {
        cwd: root,
        detached: process.platform !== "win32",
        env: { ...process.env, ...env, NO_COLOR: "1" },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    const terminate = (signal) => {
      try {
        if (process.platform === "win32") child.kill(signal);
        else process.kill(-child.pid, signal);
      } catch {
        // The process can exit between timeout and signal delivery.
      }
    };
    const timer = setTimeout(() => {
      timedOut = true;
      terminate("SIGTERM");
      setTimeout(() => terminate("SIGKILL"), 2_000).unref();
    }, 8 * 60_000);
    child.once("error", (error) => {
      clearTimeout(timer);
      resolveResult({ status: 1, stdout, stderr: `${stderr}\n${error.stack ?? error}` });
    });
    child.once("close", (code, signal) => {
      clearTimeout(timer);
      resolveResult({
        status: timedOut ? 124 : (code ?? 1),
        stdout,
        stderr: timedOut
          ? `${stderr}\nAgent canary timed out.`
          : signal
            ? `${stderr}\nAgent canary exited from ${signal}.`
            : stderr,
      });
    });
  });
}

function installPackagedCli() {
  const packRoot = join(scratch, "pack");
  mkdirSync(packRoot, { recursive: true });
  mkdirSync(cliHost, { recursive: true });
  writeFileSync(join(cliHost, "package.json"), '{"name":"framework-agent-cli-host","private":true}\n');
  const npmEnv = { npm_config_cache: join(scratch, "npm-cache") };
  run(
    "npm",
    ["pack", "--ignore-scripts", "--pack-destination", packRoot],
    { cwd: join(repositoryRoot, "packages", "cli"), env: npmEnv, timeout: 120_000 },
  );
  const archive = readdirSync(packRoot).find((name) => name.endsWith(".tgz"));
  assert(archive, "npm pack returned no CLI archive");
  run(
    "npm",
    [
      "install",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      join(packRoot, archive),
    ],
    { cwd: cliHost, env: npmEnv, timeout: 120_000 },
  );
  const installed = join(cliHost, "node_modules", "@volatodev", "cli");
  const realCli = join(installed, "dist", "cli.cjs");
  const skillRoot = join(installed, "skills");
  assert(existsSync(realCli), "packed CLI executable is missing");
  assert(existsSync(skillRoot), "packed CLI skills are missing");
  return { realCli, skillRoot };
}

function commonPackage(target) {
  const scripts = {
    test: "node --test && node scripts/mark.mjs test",
  };
  if (isAstroTarget(target)) {
    scripts.build = "astro build";
    scripts.postbuild =
      "node scripts/verify-setup.mjs && node scripts/mark.mjs build";
    scripts.test =
      "tsx --test test/capture.test.ts && node scripts/mark.mjs test";
    const rendererDependencies =
      target.astroRenderer === "react"
        ? {
            "@astrojs/react": "6.0.4",
            react: "19.2.8",
            "react-dom": "19.2.8",
            "@vitejs/plugin-react": "5.2.0",
          }
        : target.astroRenderer === "vue"
          ? {
              "@astrojs/vue": "7.0.2",
              vue: "3.5.42",
              "@vitejs/plugin-vue": "6.0.8",
            }
          : target.astroRenderer === "svelte"
            ? {
                "@astrojs/svelte": "9.0.1",
                svelte: "5.56.10",
                "@sveltejs/vite-plugin-svelte": "7.3.0",
                typescript: "5.9.3",
              }
            : {};
    return {
      name: `volato-astro-${target.astroRenderer}-agent-canary`,
      private: true,
      type: "module",
      engines: { node: "24.19.0" },
      scripts,
      dependencies: {
        astro: "7.2.9",
        "@astrojs/node": "11.1.4",
        vite: "8.2.2",
        ...rendererDependencies,
      },
      devDependencies: { tsx: "4.20.6" },
    };
  }
  if (target === targets.nuxt) {
    scripts.build = "nuxt build";
    scripts.postbuild =
      "node scripts/verify-setup.mjs && node scripts/mark.mjs build";
    scripts.test =
      "tsx --test test/capture.test.ts && node scripts/mark.mjs test";
    return {
      name: "volato-nuxt-agent-canary",
      private: true,
      type: "module",
      engines: { node: "24.19.0" },
      scripts,
      dependencies: {
        nuxt: "4.5.2",
        vue: "3.5.42",
        "vue-router": "5.2.0",
      },
      devDependencies: { tsx: "4.20.6" },
    };
  }
  if (target === targets.sveltekit) {
    scripts.build = "vite build";
    scripts.postbuild =
      "node scripts/verify-setup.mjs && node scripts/mark.mjs build";
    scripts.test =
      "tsx --test test/capture.test.ts && node scripts/mark.mjs test";
    return {
      name: "volato-sveltekit-agent-canary",
      private: true,
      type: "module",
      engines: { node: "24.19.0" },
      scripts,
      dependencies: {
        svelte: "5.56.10",
        "@sveltejs/kit": "2.70.3",
        "@sveltejs/adapter-node": "5.5.7",
        "@sveltejs/vite-plugin-svelte": "7.3.0",
        vite: "8.2.2",
      },
      devDependencies: { tsx: "4.20.6" },
    };
  }
  if (target === targets.angular) {
    scripts.build = "ng build";
    scripts.postbuild =
      "node scripts/verify-setup.mjs && node scripts/mark.mjs build";
    scripts.test =
      "tsx --test test/capture.test.ts && node scripts/mark.mjs test";
    return {
      name: "volato-angular-agent-canary",
      private: true,
      scripts,
      dependencies: {
        "@angular/common": "22.1.0",
        "@angular/compiler": "22.1.0",
        "@angular/core": "22.1.0",
        "@angular/platform-browser": "22.1.0",
        rxjs: "7.8.2",
        tslib: "2.8.1",
      },
      devDependencies: {
        "@angular/build": "22.1.6",
        "@angular/cli": "22.1.6",
        "@angular/compiler-cli": "22.1.0",
        tsx: "4.20.6",
        typescript: "6.0.2",
      },
    };
  }
  if (target === targets.vue) {
    scripts.build = "node scripts/verify-setup.mjs && vite build && node scripts/mark.mjs build";
    return {
      name: "volato-vue-agent-canary",
      private: true,
      type: "module",
      scripts,
      dependencies: {
        "@vitejs/plugin-vue": "6.0.8",
        vite: "7.3.6",
        vue: "3.5.42",
      },
    };
  }
  if (target === targets.svelte) {
    scripts.build = "node scripts/verify-setup.mjs && vite build && node scripts/mark.mjs build";
    return {
      name: "volato-svelte-agent-canary",
      private: true,
      type: "module",
      scripts,
      dependencies: {
        "@sveltejs/vite-plugin-svelte": "6.2.4",
        svelte: "5.56.10",
        vite: "7.3.6",
      },
    };
  }
  if (target === targets.fastify) {
    scripts.build = "node scripts/verify-setup.mjs && tsup src/server.ts --format esm --sourcemap --out-dir dist && node scripts/mark.mjs build";
    return {
      name: "volato-fastify-agent-canary",
      private: true,
      type: "module",
      scripts,
      dependencies: { fastify: "5.12.1" },
      devDependencies: { tsup: "8.5.1", typescript: "5.9.3", "@types/node": "24.10.0" },
    };
  }
  scripts.build = "node scripts/verify-setup.mjs && nest build && node scripts/mark.mjs build";
  return {
    name: "volato-nest-agent-canary",
    private: true,
    scripts,
    dependencies: {
      "@nestjs/common": "12.0.1",
      "@nestjs/core": "12.0.1",
      "@nestjs/platform-fastify": "12.0.1",
      fastify: "5.12.1",
      "reflect-metadata": "0.2.2",
      rxjs: "7.8.2",
    },
    devDependencies: {
      "@nestjs/cli": "11.0.24",
      "@types/node": "24.10.0",
      typescript: "5.9.3",
    },
  };
}

function writeBrowserFixture(root, target) {
  writeFileSync(
    join(root, "index.html"),
    '<div id="app"></div><script type="module" src="/src/main.js"></script>\n',
  );
  if (target === targets.vue) {
    writeFileSync(
      join(root, "vite.config.js"),
      'import { defineConfig } from "vite";\nimport vue from "@vitejs/plugin-vue";\nexport default defineConfig({ plugins: [vue()] });\n',
    );
    writeFileSync(
      join(root, "src", "main.js"),
      'import { createApp } from "vue";\nimport App from "./App.vue";\nconst app = createApp(App);\napp.mount("#app");\n',
    );
    writeFileSync(
      join(root, "src", "App.vue"),
      '<script setup>\nimport { checkoutTotal } from "./checkout.js";\nconst total = checkoutTotal([]);\n</script>\n<template><main>{{ total }}</main></template>\n',
    );
  } else {
    writeFileSync(
      join(root, "vite.config.js"),
      'import { defineConfig } from "vite";\nimport { svelte } from "@sveltejs/vite-plugin-svelte";\nexport default defineConfig({ plugins: [svelte()] });\n',
    );
    writeFileSync(
      join(root, "src", "main.js"),
      'import { mount } from "svelte";\nimport App from "./App.svelte";\nconst app = mount(App, { target: document.getElementById("app") });\nexport default app;\n',
    );
    writeFileSync(
      join(root, "src", "App.svelte"),
      '<script>\nimport { checkoutTotal } from "./checkout.js";\nconst total = checkoutTotal([]);\n</script>\n<main>{total}</main>\n',
    );
  }
}

function writeAngularFixture(root) {
  mkdirSync(join(root, "src", "app"), { recursive: true });
  writeFileSync(
    join(root, "angular.json"),
    `${JSON.stringify(
      {
        $schema: "./node_modules/@angular/cli/lib/config/schema.json",
        version: 1,
        projects: {
          "angular-canary": {
            projectType: "application",
            root: "",
            sourceRoot: "src",
            prefix: "app",
            architect: {
              build: {
                builder: "@angular/build:application",
                options: {
                  browser: "src/main.ts",
                  tsConfig: "tsconfig.app.json",
                  styles: ["src/styles.css"],
                },
                configurations: {
                  production: { outputHashing: "all" },
                  development: { optimization: false, sourceMap: true },
                },
                defaultConfiguration: "production",
              },
            },
          },
        },
      },
      null,
      2,
    )}\n`,
  );
  writeFileSync(
    join(root, "tsconfig.json"),
    `${JSON.stringify(
      {
        compilerOptions: {
          target: "ES2022",
          module: "preserve",
          moduleResolution: "bundler",
          strict: true,
          skipLibCheck: true,
          experimentalDecorators: true,
          useDefineForClassFields: false,
        },
        angularCompilerOptions: { strictTemplates: true },
      },
      null,
      2,
    )}\n`,
  );
  writeFileSync(
    join(root, "tsconfig.app.json"),
    `${JSON.stringify(
      {
        extends: "./tsconfig.json",
        compilerOptions: { outDir: "./out-tsc/app", types: [] },
        files: ["src/main.ts"],
      },
      null,
      2,
    )}\n`,
  );
  writeFileSync(
    join(root, "src", "index.html"),
    '<!doctype html><html><head><meta charset="utf-8"><base href="/"></head><body><app-root></app-root></body></html>\n',
  );
  writeFileSync(join(root, "src", "styles.css"), "body { font-family: sans-serif; }\n");
  writeFileSync(
    join(root, "src", "main.ts"),
    `import { bootstrapApplication } from "@angular/platform-browser";
import { appConfig } from "./app/app.config";
import { App } from "./app/app";
bootstrapApplication(App, appConfig).catch((error) => console.error(error));
`,
  );
  writeFileSync(
    join(root, "src", "app", "app.config.ts"),
    `import { ApplicationConfig, provideBrowserGlobalErrorListeners } from "@angular/core";
export const appConfig: ApplicationConfig = {
  providers: [provideBrowserGlobalErrorListeners()],
};
`,
  );
  writeFileSync(
    join(root, "src", "app", "app.ts"),
    `import { Component } from "@angular/core";
import { checkoutTotal } from "../checkout";
@Component({
  selector: "app-root",
  standalone: true,
  template: "<main>{{ total }}</main>",
})
export class App { readonly total = checkoutTotal([]); }
`,
  );
}

function writeNuxtFixture(root) {
  for (const directory of [
    join("app", "lib"),
    join("app", "pages"),
    join("app", "plugins"),
    join("server", "plugins"),
  ]) {
    mkdirSync(join(root, directory), { recursive: true });
  }
  writeFileSync(join(root, ".node-version"), "24.19.0\n");
  writeFileSync(
    join(root, "nuxt.config.ts"),
    `export default defineNuxtConfig({
  compatibilityDate: "2026-08-28",
  devtools: { enabled: false },
  nitro: { preset: "node-server" },
});
`,
  );
  writeFileSync(
    join(root, "tsconfig.json"),
    '{"files":[],"references":[{"path":"./.nuxt/tsconfig.app.json"},{"path":"./.nuxt/tsconfig.server.json"}]}\n',
  );
  writeFileSync(
    join(root, "app", "app.vue"),
    "<template><NuxtPage /></template>\n",
  );
  writeFileSync(
    join(root, "app", "pages", "index.vue"),
    `<script setup lang="ts">
import { checkoutTotal } from "~/lib/checkout";
const total = checkoutTotal([]);
</script>
<template><main>{{ total }}</main></template>
`,
  );
  writeFileSync(
    join(root, "app", "plugins", "10.application.client.ts"),
    `export default defineNuxtPlugin({
  name: "application-observer",
  hooks: { "app:error": () => undefined },
});
`,
  );
  writeFileSync(
    join(root, "server", "plugins", "10.application.ts"),
    `export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook("error", () => undefined);
});
`,
  );
}

function writeSvelteKitFixture(root) {
  for (const directory of [join("src", "lib"), join("src", "routes")]) {
    mkdirSync(join(root, directory), { recursive: true });
  }
  writeFileSync(join(root, ".node-version"), "24.19.0\n");
  writeFileSync(
    join(root, "vite.config.ts"),
    `import adapter from "@sveltejs/adapter-node";
import { sveltekit } from "@sveltejs/kit/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [sveltekit({ adapter: adapter() })],
});
`,
  );
  writeFileSync(
    join(root, "tsconfig.json"),
    `${JSON.stringify(
      {
        extends: "./.svelte-kit/tsconfig.json",
        compilerOptions: {
          allowJs: true,
          esModuleInterop: true,
          forceConsistentCasingInFileNames: true,
          resolveJsonModule: true,
          skipLibCheck: true,
          sourceMap: true,
          strict: true,
          moduleResolution: "bundler",
        },
      },
      null,
      2,
    )}\n`,
  );
  writeFileSync(
    join(root, "src", "app.html"),
    '<!doctype html>\n<html lang="en"><head><meta charset="utf-8">%sveltekit.head%</head><body><div style="display: contents">%sveltekit.body%</div></body></html>\n',
  );
  writeFileSync(
    join(root, "src", "routes", "+page.svelte"),
    `<script lang="ts">
  import { checkoutTotal } from "../lib/checkout";
  const total = checkoutTotal([]);
</script>
<main>{total}</main>
`,
  );
}

function writeAstroFixture(root, target) {
  mkdirSync(join(root, "src", "pages"), { recursive: true });
  mkdirSync(join(root, "src", "components"), { recursive: true });
  writeFileSync(join(root, ".node-version"), "24.19.0\n");
  const renderer = target.astroRenderer;
  const rendererImport =
    renderer === "core"
      ? ""
      : `import ${renderer} from "@astrojs/${renderer}";\n`;
  writeFileSync(
    join(root, "astro.config.mjs"),
    `import { defineConfig } from "astro/config";
import node from "@astrojs/node";
${rendererImport}
export default defineConfig({
  output: "server",
  adapter: node({ mode: "standalone" }),
  integrations: [${renderer === "core" ? "" : `${renderer}()`}],
});
`,
  );
  writeFileSync(
    join(root, "tsconfig.json"),
    `${JSON.stringify({ extends: "astro/tsconfigs/strict" }, null, 2)}\n`,
  );
  writeFileSync(
    join(root, "src", "pages", "index.astro"),
    `---
import { checkoutTotal } from "../checkout";
const total = checkoutTotal([]);
---
<main>{total}</main>
`,
  );
}

function writeFastifyFixture(root) {
  writeFileSync(
    join(root, "src", "server.ts"),
    `import Fastify from "fastify";
import { checkoutTotal } from "./checkout.js";
const app = Fastify();
app.get("/checkout", async () => ({ total: checkoutTotal([]) }));
app.listen({ port: 3000 });
`,
  );
}

function writeNestFixture(root) {
  writeFileSync(
    join(root, "src", "app.controller.ts"),
    `import { Controller, Get } from "@nestjs/common";
import { checkoutTotal } from "./checkout";
@Controller()
export class AppController {
  @Get("checkout") checkout() { return { total: checkoutTotal([]) }; }
}
`,
  );
  writeFileSync(
    join(root, "src", "app.module.ts"),
    `import { Module } from "@nestjs/common";
import { AppController } from "./app.controller";
@Module({ controllers: [AppController] })
export class AppModule {}
`,
  );
  writeFileSync(
    join(root, "src", "main.ts"),
    `import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, NestFastifyApplication } from "@nestjs/platform-fastify";
import { AppModule } from "./app.module";
async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter());
  await app.listen(3000);
}
void bootstrap();
`,
  );
  writeFileSync(
    join(root, "tsconfig.json"),
    `${JSON.stringify(
      {
        compilerOptions: {
          target: "ES2022",
          module: "CommonJS",
          moduleResolution: "Node",
          outDir: "dist",
          rootDir: "src",
          sourceMap: true,
          strict: true,
          skipLibCheck: true,
          experimentalDecorators: true,
          emitDecoratorMetadata: true,
          esModuleInterop: true,
        },
        include: ["src/**/*.ts"],
      },
      null,
      2,
    )}\n`,
  );
  writeFileSync(
    join(root, "tsconfig.build.json"),
    `${JSON.stringify({ extends: "./tsconfig.json", exclude: ["test", "dist"] }, null, 2)}\n`,
  );
  writeFileSync(
    join(root, "nest-cli.json"),
    `${JSON.stringify({ sourceRoot: "src", compilerOptions: { tsConfigPath: "tsconfig.build.json" } }, null, 2)}\n`,
  );
}

function writeFastApiFixture(root) {
  writeFileSync(join(root, ".python-version"), "3.12\n");
  writeFileSync(
    join(root, "pyproject.toml"),
    `[project]\nname = "volato-fastapi-agent-canary"\nrequires-python = "==3.12.*"\ndependencies = [\n  "fastapi==0.141.1",\n  "starlette==1.6.0",\n  "uvicorn==0.52.4",\n  "pydantic==2.13.5",\n  "anyio==4.14.2",\n]\n`,
  );
  writeFileSync(
    join(root, "app.py"),
    `from fastapi import FastAPI\nfrom checkout import checkout_total\n\napp = FastAPI()\n\n@app.get("/checkout")\nasync def checkout():\n    return {"total": checkout_total([])}\n`,
  );
}

function verifySetupSource(target) {
  if (target === targets.fastapi) {
    return `from pathlib import Path
import json
import py_compile

source = Path("app.py").read_text()
assert "VolatoASGIMiddleware" in source
assert "init_volato" in source
assert json.loads(Path(".volato/manifest.json").read_text())["integrations"]["errors-python-fastapi"]
for path in ["app.py", "checkout.py", "volato_errors/__init__.py", "volato_errors/runtime.py", "volato_errors/asgi.py"]:
    py_compile.compile(path, doraise=True)
Path(".volato-eval-build").write_text("ok\\n")
`;
  }
  if (target === targets.sveltekit) {
    return `import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

assert.match(readFileSync("vite.config.ts", "utf8"), /withVolatoSvelteKit/);
assert.match(readFileSync("src/hooks.client.ts", "utf8"), /createVolatoSvelteKitClientHandleError/);
assert.match(readFileSync("src/hooks.server.ts", "utf8"), /createVolatoSvelteKitServerHandleError/);
assert.match(readFileSync("package.json", "utf8"), /upload-sourcemaps[.]mjs/);
assert.ok(JSON.parse(readFileSync(".volato/manifest.json", "utf8")).integrations["errors-sveltekit"]);

function files(root) {
  const found = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) found.push(...files(path));
    else found.push(path);
  }
  return found;
}
assert.equal(files("build").some((path) => path.endsWith(".map")), false);
assert.equal(files(".svelte-kit/output").some((path) => path.endsWith(".map")), false);
`;
  }
  if (isAstroTarget(target)) {
    return `import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

assert.match(readFileSync("astro.config.mjs", "utf8"), /withVolatoAstro/);
assert.match(readFileSync("package.json", "utf8"), /volato-astro\\/upload-sourcemaps[.]mjs/);
assert.ok(JSON.parse(readFileSync(".volato/manifest.json", "utf8")).integrations["errors-astro"]);
for (const file of ["browser.mjs", "node.mjs", "client.mjs", "middleware.mjs", "build.mjs", "upload-sourcemaps.mjs"]) {
  assert.ok(readFileSync(join("volato-astro", file), "utf8").length > 0);
}
function files(root) {
  const found = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) found.push(...files(path));
    else found.push(path);
  }
  return found;
}
assert.equal(files("dist").some((path) => path.endsWith(".map")), false);
`;
  }
  if (target === targets.angular) {
    return `import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
assert.match(readFileSync("src/app/app.config.ts", "utf8"), /provideVolatoAngular/);
assert.match(readFileSync("package.json", "utf8"), /angular-build\\.mjs/);
assert.deepEqual(JSON.parse(readFileSync("angular.json", "utf8")).projects["angular-canary"].architect.build.configurations.production.sourceMap, { scripts: true, styles: false, hidden: true, sourcesContent: true });
assert.ok(JSON.parse(readFileSync(".volato/manifest.json", "utf8")).integrations["errors-browser-angular"]);
`;
  }
  if (target === targets.nuxt) {
    return `import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
assert.match(readFileSync("nuxt.config.ts", "utf8"), /withVolatoNuxt/);
assert.match(readFileSync("app/plugins/00.volato-errors.client.ts", "utf8"), /installVolatoNuxtClient/);
assert.match(readFileSync("server/plugins/00.volato-errors.ts", "utf8"), /installVolatoNitro/);
assert.match(readFileSync("package.json", "utf8"), /upload-sourcemaps[.]mjs/);
assert.ok(JSON.parse(readFileSync(".volato/manifest.json", "utf8")).integrations["errors-nuxt"]);
`;
  }
  if (target === targets.vue) {
    return `import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
assert.match(readFileSync("src/main.js", "utf8"), /installVolatoVue/);
assert.match(readFileSync("vite.config.js", "utf8"), /withVolato/);
assert.ok(JSON.parse(readFileSync(".volato/manifest.json", "utf8")).integrations["errors-browser-vue"]);
`;
  }
  if (target === targets.svelte) {
    return `import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
assert.match(readFileSync("src/main.js", "utf8"), /VolatoSvelteRoot/);
assert.match(readFileSync("src/volato/VolatoSvelteRoot.svelte", "utf8"), /<svelte:boundary/);
assert.match(readFileSync("vite.config.js", "utf8"), /withVolato/);
assert.ok(JSON.parse(readFileSync(".volato/manifest.json", "utf8")).integrations["errors-browser-svelte"]);
`;
  }
  if (target === targets.fastify) {
    return `import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const source = readFileSync("src/server.ts", "utf8");
assert.match(source, /initVolatoNode/);
assert.match(source, /volatoFastifyErrorHook/);
assert.ok(JSON.parse(readFileSync(".volato/manifest.json", "utf8")).integrations["errors-node-fastify"]);
`;
  }
  return `import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const source = readFileSync("src/main.ts", "utf8");
assert.match(source, /initVolatoNode/);
assert.match(source, /VolatoHttpExceptionFilter/);
assert.ok(JSON.parse(readFileSync(".volato/manifest.json", "utf8")).integrations["errors-node-nestjs"]);
`;
}

function captureTestSource(target) {
  if (target === targets.fastapi) {
    return `import asyncio
import unittest
from pathlib import Path

from checkout import checkout_total
from volato_errors import capture_exception, init_volato


class CheckoutTest(unittest.TestCase):
    @classmethod
    def tearDownClass(cls):
        Path(".volato-eval-test").write_text("ok\\n")

    def test_empty_checkout(self):
        self.assertEqual(checkout_total([]), 0)

    def test_generated_capture(self):
        init_volato()
        try:
            raise RuntimeError("FastAPI setup canary")
        except RuntimeError as error:
            self.assertTrue(asyncio.run(capture_exception(error)))
`;
  }
  if (target === targets.angular) {
    return `import assert from "node:assert/strict";
import test from "node:test";
import { checkoutTotal } from "../src/checkout.ts";

test("empty checkout remains valid", () => {
  assert.equal(checkoutTotal([]), 0);
});

test("generated Angular runtime delivers a bounded event", async () => {
  globalThis.window = { addEventListener() {}, removeEventListener() {} };
  const runtime = await import("../src/volato/browser.ts");
  runtime.initVolatoBrowser({ dsn: process.env.VOLATO_TEST_DSN, environment: "production", release: process.env.VOLATO_RELEASE });
  const delivered = await runtime.captureBrowserError(new Error("Angular setup canary"), { capturedVia: "angular_error_handler" });
  assert.equal(delivered, true);
});
`;
  }
  if (target === targets.nuxt) {
    return `import assert from "node:assert/strict";
import test from "node:test";
import { checkoutTotal } from "../app/lib/checkout.ts";

test("empty checkout remains valid", () => {
  assert.equal(checkoutTotal([]), 0);
});

test("generated Nuxt browser and Nitro runtimes deliver bounded events", async () => {
  globalThis.window = { addEventListener() {}, removeEventListener() {} };
  const browser = await import("../volato-nuxt/browser.ts");
  browser.initVolatoBrowser({ dsn: process.env.VOLATO_TEST_DSN, environment: "production", release: process.env.VOLATO_RELEASE });
  assert.equal(await browser.captureBrowserError(new Error("Nuxt browser setup canary"), { capturedVia: "nuxt_app_error" }), true);

  const node = await import("../volato-nuxt/node.ts");
  node.initVolatoNode({ dsn: process.env.VOLATO_TEST_DSN, environment: "production", release: process.env.VOLATO_RELEASE, installFatalHandlers: false });
  assert.equal(await node.captureNodeException(new Error("Nuxt Nitro setup canary"), { capturedVia: "nitro_error" }), true);
});
`;
  }
  if (target === targets.sveltekit) {
    return `import assert from "node:assert/strict";
import test from "node:test";
import { checkoutTotal } from "../src/lib/checkout.ts";

test("empty checkout remains valid", () => {
  assert.equal(checkoutTotal([]), 0);
});

test("generated SvelteKit browser and server runtimes deliver bounded events", async () => {
  globalThis.window = { addEventListener() {}, removeEventListener() {} };
  const browser = await import("../volato-sveltekit/browser.ts");
  browser.initVolatoBrowser({ dsn: process.env.VOLATO_TEST_DSN, environment: "production", release: process.env.VOLATO_RELEASE });
  assert.equal(await browser.captureBrowserError(new Error("SvelteKit browser setup canary"), { capturedVia: "sveltekit_client_handle_error" }), true);

  const node = await import("../volato-sveltekit/node.ts");
  node.initVolatoNode({ dsn: process.env.VOLATO_TEST_DSN, environment: "production", release: process.env.VOLATO_RELEASE, installFatalHandlers: false });
  assert.equal(await node.captureNodeException(new Error("SvelteKit server setup canary"), { capturedVia: "sveltekit_server_handle_error", method: "POST", route: "/checkout", status: 500, requestId: "sveltekit-canary" }), true);
});
`;
  }
  if (isAstroTarget(target)) {
    const browserOwner =
      target.astroRenderer === "vue"
        ? "vue_error_handler"
        : target.astroRenderer === "svelte"
          ? "astro_hydration_error"
          : "window_error";
    return `import assert from "node:assert/strict";
import test from "node:test";
import { checkoutTotal } from "../src/checkout.ts";

test("empty checkout remains valid", () => {
  assert.equal(checkoutTotal([]), 0);
});

test("generated Astro browser and standalone Node runtimes deliver bounded events", async () => {
  globalThis.window = { addEventListener() {}, removeEventListener() {} };
  const browser = await import("../volato-astro/browser.mjs");
  browser.initVolatoBrowser({ dsn: process.env.VOLATO_TEST_DSN, environment: "production", release: process.env.VOLATO_RELEASE });
  assert.equal(await browser.captureBrowserError(new Error("Astro ${target.astroRenderer} browser setup canary"), { capturedVia: "${browserOwner}" }), true);

  const node = await import("../volato-astro/node.mjs");
  node.initVolatoNode({ dsn: process.env.VOLATO_TEST_DSN, environment: "production", release: process.env.VOLATO_RELEASE, installFatalHandlers: false });
  assert.equal(await node.captureNodeException(new Error("Astro standalone Node setup canary"), { capturedVia: "astro_middleware", method: "POST", route: "/checkout", status: 500, requestId: "astro-canary" }), true);
});
`;
  }
  const extension = target.language === "js" ? "js" : "ts";
  const runtimeRoot = target.runtime === "browser" ? "volato" : "volato-node";
  const runtimeFile = target.runtime === "browser" ? "browser.js" : "node.ts";
  const init = target.runtime === "browser" ? "initVolatoBrowser" : "initVolatoNode";
  const capture = target.runtime === "browser" ? "captureBrowserError" : "captureNodeException";
  const windowSetup = target.runtime === "browser"
    ? 'globalThis.window = { addEventListener() {}, removeEventListener() {} };\n'
    : "";
  const initOptions = target.runtime === "browser"
    ? '{ dsn: process.env.VOLATO_TEST_DSN, environment: "production", release: process.env.VOLATO_RELEASE }'
    : '{ dsn: process.env.VOLATO_TEST_DSN, environment: "production", release: process.env.VOLATO_RELEASE, installFatalHandlers: false }';
  return `import assert from "node:assert/strict";
import test from "node:test";
import { checkoutTotal } from "../src/checkout.${extension}";

test("empty checkout remains valid", () => {
  assert.equal(checkoutTotal([]), 0);
});

test("generated ${target.label} runtime delivers a bounded event", async () => {
  ${windowSetup}const runtime = await import("../src/${runtimeRoot}/${runtimeFile}");
  runtime.${init}(${initOptions});
  const delivered = await runtime.${capture}(new Error("${target.label} setup canary"), { capturedVia: "${target.capturedVia}" });
  assert.equal(delivered, true);
});
`;
}

function writeFixture(root, target, skillRoot, realCli) {
  for (const directory of ["src", "test", "scripts", "bin", join(".agents", "skills")]) {
    mkdirSync(join(root, directory), { recursive: true });
  }
  writeFileSync(
    join(root, "AGENTS.md"),
    `# Canary context\n\nThe human already selected and authorized Volato project \`${target.projectId}\`. Work autonomously, use the installed Volato skills, run the production build and tests, and do not ask for another authorization.${target === targets.fastapi ? " Use `.venv/bin/python scripts/verify_setup.py` as the production import check and `.venv/bin/python -m unittest` as the repository-native test command." : ""}\n`,
  );
  writeFileSync(
    join(root, ".gitignore"),
    "node_modules/\ndist/\nbuild/\n.angular/\n.nuxt/\n.output/\n.svelte-kit/\n.venv/\n__pycache__/\n.env*.local\n.volato-eval-*\n",
  );
  if (target !== targets.fastapi) {
    writeFileSync(
      join(root, "package.json"),
      `${JSON.stringify(commonPackage(target), null, 2)}\n`,
    );
  }
  if (target === targets.fastapi) writeFastApiFixture(root);
  else if (target === targets.nuxt) writeNuxtFixture(root);
  else if (target === targets.sveltekit) writeSvelteKitFixture(root);
  else if (isAstroTarget(target)) writeAstroFixture(root, target);
  else if (target === targets.angular) writeAngularFixture(root);
  else if (target.runtime === "browser") writeBrowserFixture(root, target);
  else if (target === targets.fastify) writeFastifyFixture(root);
  else writeNestFixture(root);
  const extension = target.language === "js" ? "js" : target.language === "py" ? "py" : "ts";
  const testName =
    target === targets.angular ||
    target === targets.nuxt ||
    target === targets.sveltekit ||
    isAstroTarget(target)
      ? "capture.test.ts"
      : "capture.test.mjs";
  if (target === targets.fastapi) {
    writeFileSync(
      join(root, "checkout.py"),
      `from functools import reduce\n\ndef checkout_total(lines):\n    return reduce(lambda total, line: total + line["price"], lines, 0)\n`,
    );
  } else if (target === targets.nuxt) {
    writeFileSync(
      join(root, "app", "lib", "checkout.ts"),
      `export function checkoutTotal(lines: Array<{ price: number }>) {
  return lines.map((line) => line.price).reduce((sum, price) => sum + price, 0);
}
`,
    );
  } else if (target === targets.sveltekit) {
    writeFileSync(
      join(root, "src", "lib", "checkout.ts"),
      `export function checkoutTotal(lines: Array<{ price: number }>) {
  return lines.map((line) => line.price).reduce((sum, price) => sum + price, 0);
}
`,
    );
  } else {
    writeFileSync(
      join(root, "src", `checkout.${extension}`),
      `export function checkoutTotal(lines${extension === "ts" ? ": Array<{ price: number }>" : ""}) {
  return lines.map((line) => line.price).reduce((sum, price) => sum + price, 0);
}
`,
    );
  }
  if (target === targets.fastapi) {
    writeFileSync(
      join(root, "scripts", "verify_setup.py"),
      verifySetupSource(target),
    );
    writeFileSync(
      join(root, "test", "test_checkout.py"),
      captureTestSource(target),
    );
    writeFileSync(join(root, "test", "__init__.py"), "");
  } else {
    writeFileSync(
      join(root, "scripts", "verify-setup.mjs"),
      verifySetupSource(target),
    );
    writeFileSync(
      join(root, "scripts", "mark.mjs"),
      'import { writeFileSync } from "node:fs";\nwriteFileSync(`.volato-eval-${process.argv[2]}`, "ok\\n");\n',
    );
    writeFileSync(
      join(root, "test", testName),
      captureTestSource(target),
    );
  }
  for (const name of ["volato-setup", "volato-errors", target.skill]) {
    cpSync(join(skillRoot, name), join(root, ".agents", "skills", name), {
      recursive: true,
    });
  }
  const wrapper = `#!/usr/bin/env node
import { appendFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
const args = process.argv.slice(2);
const result = spawnSync(process.execPath, [process.env.VOLATO_REAL_CLI, ...args], { stdio: "inherit", env: process.env });
const status = result.status ?? 1;
appendFileSync(process.env.VOLATO_EVAL_COMMAND_LOG, JSON.stringify({ args, status }) + "\\n");
process.exit(status);
`;
  writeFileSync(join(root, "bin", "volato"), wrapper);
  chmodSync(join(root, "bin", "volato"), 0o755);

  if (target === targets.fastapi) {
    run("python3", ["-m", "venv", ".venv"], { cwd: root, timeout: 120_000 });
    run(
      join(root, ".venv", "bin", "python"),
      [
        "-m",
        "pip",
        "install",
        "--quiet",
        "fastapi==0.141.1",
        "starlette==1.6.0",
        "uvicorn==0.52.4",
        "pydantic==2.13.5",
        "anyio==4.14.2",
      ],
      { cwd: root, timeout: 300_000 },
    );
  } else {
    run("pnpm", ["install", "--ignore-scripts"], { cwd: root, timeout: 300_000 });
  }
  run("git", ["init", "--quiet"], { cwd: root });
  run("git", ["config", "user.email", "canary@volato.dev"], { cwd: root });
  run("git", ["config", "user.name", "Volato Canary"], { cwd: root });
  run("git", ["add", "."], { cwd: root });
  run("git", ["commit", "--quiet", "-m", `feat: add ${target.label} canary`], { cwd: root });
  return { realCli };
}

function readJsonLines(path) {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function multipartField(body, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(
    `name="${escaped}"(?:; filename="[^"]+")?\\r\\n(?:Content-Type:[^\\r]+\\r\\n)?\\r\\n([\\s\\S]*?)\\r\\n--`,
  ).exec(body)?.[1];
}

function errorGroup(target) {
  return {
    id: target.groupId,
    projectId: target.projectId,
    projectName: `${target.label} canary`,
    fingerprint: `framework-${target.capturedVia}`,
    message: "Reduce of empty array with no initial value",
    severity: "error",
    status: "unresolved",
    eventCount: 12,
    matchingEventCount: 12,
    affectedUserCount: 4,
    firstSeen: "2026-08-27T08:00:00.000Z",
    lastSeen: "2026-08-27T09:00:00.000Z",
    firstMatchedAt: "2026-08-27T08:00:00.000Z",
    lastMatchedAt: "2026-08-27T09:00:00.000Z",
    runtimes: [target.runtime],
    routes: [target.route],
    releases: [target.release],
    baselineEventCount: 0,
    growthDelta: 12,
    growthRatio: null,
  };
}

function startMockApi(root, target, state) {
  const requestLog = join(root, ".volato-eval-requests.jsonl");
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    writeFileSync(
      requestLog,
      `${existsSync(requestLog) ? readFileSync(requestLog, "utf8") : ""}${JSON.stringify({ method: request.method, url: request.url })}\n`,
    );
    const send = (data, status = 200, markdown = "") => {
      request.resume();
      response.writeHead(status, { "content-type": "application/json", "access-control-allow-origin": "*" });
      response.end(JSON.stringify(status >= 200 && status < 300 ? { markdown, data } : { error: data }));
    };
    if (request.method === "GET" && url.pathname === `/v1/projects/${target.projectId}/setup`) {
      const address = server.address();
      send({
        projectId: target.projectId,
        projectName: `${target.label} canary`,
        dsn: `http://public@127.0.0.1:${address.port}/${target.projectId}`,
        ingestToken,
      });
      return;
    }
    if (request.method === "POST" && url.pathname === `/v1/projects/${target.projectId}/linked`) {
      send({ projectId: target.projectId, linked: true });
      return;
    }
    if (request.method === "POST" && url.pathname === `/v1/projects/${target.projectId}/integrations/${target.integrationId}`) {
      state.activationCount += 1;
      send({ installed: true });
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/sourcemaps") {
      let body = Buffer.alloc(0);
      request.on("data", (chunk) => {
        body = Buffer.concat([body, chunk]);
      });
      request.on("end", () => {
        state.maps.push(body.toString("utf8"));
        response.writeHead(201, { "content-type": "application/json" });
        response.end(JSON.stringify({ data: { uploaded: true } }));
      });
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/ingest") {
      let body = "";
      request.setEncoding("utf8");
      request.on("data", (chunk) => {
        body += chunk;
      });
      request.on("end", () => {
        state.events.push(JSON.parse(body));
        response.writeHead(202, { "content-type": "application/json", "access-control-allow-origin": "*" });
        response.end(JSON.stringify({ data: { accepted: true } }));
      });
      return;
    }
    if (request.method === "GET" && url.pathname === "/v1/errors/context") {
      const context = state.recoveryContext;
      send(
        context,
        200,
        context
          ? `# Reduce of empty array with no initial value\n\n**Status:** unresolved\n**Source:** ${context.resolvedFrame.original_path}:${context.resolvedFrame.original_line}\n**Runtime:** ${target.runtime}\n**Captured via:** ${target.capturedVia}\n\nPatch the causal source and keep production status unresolved until deployment evidence exists.`
          : "No production error was found.",
      );
      return;
    }
    if (request.method === "GET" && url.pathname === "/v1/errors") {
      send({ kind: "ok", rows: state.recoveryContext ? [errorGroup(target)] : [], nextCursor: null, query: {} });
      return;
    }
    if (request.method === "GET" && url.pathname === "/v1/releases") {
      const latest = state.events.length > 0
        ? {
            release: target.release,
            commitShas: [target.release],
            projectIds: [target.projectId],
            runtimes: [target.runtime],
            eventCount: state.events.length,
            groupCount: 1,
            firstSeen: "2026-08-27T08:00:00.000Z",
            lastSeen: "2026-08-27T09:00:00.000Z",
          }
        : null;
      send({
        kind: "ok",
        releases: latest ? [latest] : [],
        latest,
        previous: null,
        nextCursor: null,
        query: {},
      });
      return;
    }
    if (request.method === "GET" && url.pathname === "/v1/releases/compare") {
      send({ kind: "previous_release_unavailable" });
      return;
    }
    if (request.method === "GET" && url.pathname === `/v1/errors/${target.groupId}/events`) {
      send({
        kind: "ok",
        group: {
          id: target.groupId,
          projectId: target.projectId,
          message: "Reduce of empty array with no initial value",
          fingerprint: `framework-${target.capturedVia}`,
        },
        samples: [{ roles: ["recent", "representative"], event: state.recoveryContext?.events[0] }],
        scan: { candidatesConsidered: 1, candidateLimit: 200 },
        query: {},
        privacy: "request bodies, cookies, headers and query values excluded",
      });
      return;
    }
    if (request.method === "POST" && url.pathname === `/v1/errors/${target.groupId}/resolve`) {
      state.resolveCount += 1;
      send({ status: "resolved" });
      return;
    }
    send("not_found", 404);
  });
  return { server, requestLog };
}

async function listen(server) {
  await new Promise((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  return server.address().port;
}

async function close(server) {
  await new Promise((resolveClose) => server.close(resolveClose));
}

function agentEnvironment(root, target, realCli, port, commandLog) {
  const dsn = `http://public@127.0.0.1:${port}/${target.projectId}`;
  return {
    PATH: `${join(root, "bin")}:${process.env.PATH ?? ""}`,
    VOLATO_API_URL: `http://127.0.0.1:${port}`,
    VOLATO_TOKEN: authToken,
    VOLATO_REAL_CLI: realCli,
    VOLATO_EVAL_COMMAND_LOG: commandLog,
    VOLATO_RELEASE: target.release,
    VOLATO_DSN: dsn,
    VITE_VOLATO_DSN: dsn,
    VITE_VOLATO_ENVIRONMENT: "production",
    VOLATO_TEST_DSN: dsn,
    VOLATO_INGEST_TOKEN: ingestToken,
  };
}

function traceUses(trace, skill) {
  return trace.includes(`${skill}/SKILL.md`) || trace.includes(`$${skill}`);
}

async function runTargetCanaries(name, target, packaged) {
  const root = join(scratch, name);
  const commandLog = join(root, ".volato-eval-commands.jsonl");
  const state = {
    activationCount: 0,
    maps: [],
    events: [],
    resolveCount: 0,
    recoveryContext: null,
  };
  writeFixture(root, target, packaged.skillRoot, packaged.realCli);
  const { server, requestLog } = startMockApi(root, target, state);
  const port = await listen(server);
  const env = agentEnvironment(root, target, packaged.realCli, port, commandLog);
  try {
    const setupStarted = Date.now();
    const setup = await runAgent(root, "Install Volato in this project.", env);
    const setupTrace = `${setup.stdout}\n${setup.stderr}`;
    writeFileSync(join(root, ".volato-eval-setup-trace.jsonl"), setupTrace);
    const setupCommands = readJsonLines(commandLog);
    const manifest = existsSync(join(root, ".volato", "manifest.json"))
      ? JSON.parse(readFileSync(join(root, ".volato", "manifest.json"), "utf8"))
      : {};
    const setupResult = {
      prompt: "Install Volato in this project.",
      target: target.label,
      cliArtifact: "npm pack",
      agentExitCode: setup.status,
      selectedSetupSkill: traceUses(setupTrace, "volato-setup"),
      selectedTargetSkill: traceUses(setupTrace, target.skill),
      linkedProject: setupCommands.some(
        ({ args, status }) =>
          args[0] === "init" &&
          args.includes("--project") &&
          args.includes(target.projectId) &&
          status === 0,
      ),
      initializedErrors: setupCommands.some(
        ({ args, status }) => args[0] === "errors" && args[1] === "init" && status === 0,
      ),
      integrationGenerated: Boolean(manifest.integrations?.[target.integrationId]),
      activationReported: state.activationCount > 0,
      productionBuildPassed: existsSync(join(root, ".volato-eval-build")),
      captureCheckPassed: existsSync(join(root, ".volato-eval-test")) && state.events.length > 0,
      sourcemapUploaded: state.maps.length > 0,
      directSourceCaptured:
        target === targets.fastapi &&
        state.events.some(
          (event) =>
            event.runtime === "python" &&
            String(event.stack ?? "").includes('File "test/test_checkout.py"'),
        ),
      nuxtBrowserCaptured:
        target === targets.nuxt &&
        state.events.some(
          (event) =>
            event.runtime === "browser" && event.capturedVia === "nuxt_app_error",
        ),
      nuxtNitroCaptured:
        target === targets.nuxt &&
        state.events.some(
          (event) => event.runtime === "node" && event.capturedVia === "nitro_error",
        ),
      svelteKitBrowserCaptured:
        target === targets.sveltekit &&
        state.events.some(
          (event) =>
            event.runtime === "browser" &&
            event.capturedVia === "sveltekit_client_handle_error",
        ),
      svelteKitServerCaptured:
        target === targets.sveltekit &&
        state.events.some(
          (event) =>
            event.runtime === "node" &&
            event.capturedVia === "sveltekit_server_handle_error",
        ),
      svelteKitMapFamiliesUploaded:
        target === targets.sveltekit &&
        ["_app/", "build/server/", ".svelte-kit/output/server/"].every(
          (prefix) =>
            state.maps.some((body) =>
              multipartField(body, "display_path")?.startsWith(prefix),
            ),
        ),
      astroBrowserCaptured:
        isAstroTarget(target) &&
        state.events.some((event) => event.runtime === "browser"),
      astroServerCaptured:
        isAstroTarget(target) &&
        state.events.some(
          (event) =>
            event.runtime === "node" && event.capturedVia === "astro_middleware",
        ),
      astroMapFamiliesUploaded:
        isAstroTarget(target) &&
        ["_astro/", "server/"].every((prefix) =>
          state.maps.some((body) =>
            multipartField(body, "display_path")?.startsWith(prefix),
          ),
        ),
      wallClockMs: Date.now() - setupStarted,
    };
    for (const [passed, message] of [
      [setup.status === 0, `${target.label} setup agent did not complete`],
      [setupResult.selectedSetupSkill, `${target.label} setup did not inspect volato-setup`],
      [setupResult.selectedTargetSkill, `${target.label} setup did not inspect ${target.skill}`],
      [setupResult.linkedProject, `${target.label} setup did not link the selected project`],
      [setupResult.initializedErrors, `${target.label} setup did not initialize Errors`],
      [setupResult.integrationGenerated, `${target.label} integration was not generated`],
      [setupResult.activationReported, `${target.label} activation was not reported`],
      [setupResult.productionBuildPassed, `${target.label} production build was not run`],
      [setupResult.captureCheckPassed, `${target.label} capture check did not deliver an event`],
      [
        setupResult.sourcemapUploaded || setupResult.directSourceCaptured,
        `${target.label} build proved neither sourcemap nor direct source`,
      ],
      [
        target !== targets.nuxt || setupResult.nuxtBrowserCaptured,
        `${target.label} setup did not exercise the generated browser runtime`,
      ],
      [
        target !== targets.nuxt || setupResult.nuxtNitroCaptured,
        `${target.label} setup did not exercise the generated Nitro runtime`,
      ],
      [
        target !== targets.sveltekit || setupResult.svelteKitBrowserCaptured,
        `${target.label} setup did not exercise the generated browser runtime`,
      ],
      [
        target !== targets.sveltekit || setupResult.svelteKitServerCaptured,
        `${target.label} setup did not exercise the generated server runtime`,
      ],
      [
        target !== targets.sveltekit ||
          setupResult.svelteKitMapFamiliesUploaded,
        `${target.label} setup did not upload all three sourcemap families`,
      ],
      [
        !isAstroTarget(target) || setupResult.astroBrowserCaptured,
        `${target.label} setup did not exercise the generated browser runtime`,
      ],
      [
        !isAstroTarget(target) || setupResult.astroServerCaptured,
        `${target.label} setup did not exercise the generated standalone Node runtime`,
      ],
      [
        !isAstroTarget(target) || setupResult.astroMapFamiliesUploaded,
        `${target.label} setup did not upload both sourcemap families`,
      ],
    ]) assert(passed, message);

    run("git", ["add", "."], { cwd: root });
    run("git", ["commit", "--quiet", "-m", `chore: install Volato for ${target.label}`], { cwd: root });
    const priorCleanCommit = run("git", ["rev-parse", "HEAD"], { cwd: root }).stdout.trim();
    const extension =
      target.language === "js" ? "js" : target.language === "py" ? "py" : "ts";
    const causalPath =
      target === targets.fastapi
        ? "checkout.py"
        : target === targets.nuxt
          ? "app/lib/checkout.ts"
          : target === targets.sveltekit
            ? "src/lib/checkout.ts"
            : `src/checkout.${extension}`;
    writeFileSync(
      join(root, causalPath),
      target === targets.fastapi
        ? `from functools import reduce

def checkout_total(lines):
    return reduce(lambda total, line: total + line["price"], lines)
`
        : `export function checkoutTotal(lines${extension === "ts" ? ": Array<{ price: number }>" : ""}) {
  return lines.map((line) => line.price).reduce((sum, price) => sum + price);
}
`,
    );
    run("git", ["add", causalPath], { cwd: root });
    run("git", ["commit", "--quiet", "-m", "refactor: simplify checkout total"], { cwd: root });
    const firstSeenCommit = run("git", ["rev-parse", "HEAD"], { cwd: root }).stdout.trim();
    state.recoveryContext = {
      group: errorGroup(target),
      events: [
        {
          runtime: target.runtime,
          capturedVia: target.capturedVia,
          environment: "production",
          release: target.release,
          route: target.route,
        },
      ],
      commitTransition: { priorCleanCommit, firstSeenCommit },
      resolvedFrame: {
        original_path: causalPath,
        original_line: target === targets.fastapi ? 4 : 2,
        original_column: target === targets.fastapi ? 1 : 35,
      },
      resolutionState: "unresolved",
      history: [],
      affectedUsers: { count: 4 },
      similarResolved: [],
    };
    if (existsSync(join(root, ".volato-eval-test"))) unlinkSync(join(root, ".volato-eval-test"));
    const commandCount = readJsonLines(commandLog).length;
    const requestCount = readJsonLines(requestLog).length;
    const recoveryStarted = Date.now();
    const recovery = await runAgent(root, "Fix the latest production error.", env);
    const recoveryTrace = `${recovery.stdout}\n${recovery.stderr}`;
    writeFileSync(join(root, ".volato-eval-recovery-trace.jsonl"), recoveryTrace);
    const recoveryCommands = readJsonLines(commandLog).slice(commandCount);
    const recoveryRequests = readJsonLines(requestLog).slice(requestCount);
    const changedFiles = run("git", ["diff", "--name-only", firstSeenCommit], { cwd: root })
      .stdout.trim()
      .split("\n")
      .filter(Boolean);
    const verification = run(
      target === targets.angular
        ? "pnpm"
        : target === targets.nuxt
          ? "pnpm"
        : target === targets.sveltekit
            ? "pnpm"
            : isAstroTarget(target)
              ? "pnpm"
            : target === targets.fastapi
              ? join(root, ".venv", "bin", "python")
              : process.execPath,
      target === targets.angular
        ? [
            "exec",
            "tsx",
            "--test",
            "--test-name-pattern=empty checkout remains valid",
            "test/capture.test.ts",
          ]
        : target === targets.nuxt
          ? [
              "exec",
              "tsx",
              "--test",
              "--test-name-pattern=empty checkout remains valid",
              "test/capture.test.ts",
            ]
          : target === targets.sveltekit
            ? [
                "exec",
                "tsx",
                "--test",
                "--test-name-pattern=empty checkout remains valid",
                "test/capture.test.ts",
              ]
            : isAstroTarget(target)
              ? [
                  "exec",
                  "tsx",
                  "--test",
                  "--test-name-pattern=empty checkout remains valid",
                  "test/capture.test.ts",
                ]
            : target === targets.fastapi
              ? [
                  "-m",
                  "unittest",
                  "test.test_checkout.CheckoutTest.test_empty_checkout",
                ]
              : [
                  "--test",
                  "--test-name-pattern=empty checkout remains valid",
                  "test/capture.test.mjs",
                ],
      { cwd: root, allowFailure: true, env },
    );
    const recoveryResult = {
      prompt: "Fix the latest production error.",
      target: target.label,
      cliArtifact: "npm pack",
      agentExitCode: recovery.status,
      selectedErrorsSkill: traceUses(recoveryTrace, "volato-errors"),
      requestedProductionContext: recoveryRequests.some(
        ({ method, url }) => method === "GET" && url.startsWith("/v1/errors/context?"),
      ),
      scopedLinkedProject: recoveryRequests.some(
        ({ url }) => url.includes(`projectId=${encodeURIComponent(target.projectId)}`),
      ),
      usedOperationalCli: recoveryCommands.some(
        ({ args, status }) => args[0] === "errors" && args[1] === "show" && status === 0,
      ),
      testsRunByAgent: existsSync(join(root, ".volato-eval-test")),
      testsPassed:
        existsSync(join(root, ".volato-eval-test")) && verification.status === 0,
      causalPatchOnly: changedFiles.length === 1 && changedFiles[0] === causalPath,
      resolvedBeforeDeploy: state.resolveCount > 0,
      wallClockMs: Date.now() - recoveryStarted,
    };
    for (const [passed, message] of [
      [recovery.status === 0, `${target.label} recovery agent did not complete`],
      [recoveryResult.selectedErrorsSkill, `${target.label} recovery did not inspect volato-errors`],
      [recoveryResult.requestedProductionContext, `${target.label} recovery did not request production context`],
      [recoveryResult.scopedLinkedProject, `${target.label} recovery did not scope the linked project`],
      [recoveryResult.usedOperationalCli, `${target.label} recovery did not use the packed Errors CLI`],
      [recoveryResult.testsRunByAgent, `${target.label} recovery agent did not run tests`],
      [recoveryResult.testsPassed, `${target.label} recovery patch failed tests`],
      [recoveryResult.causalPatchOnly, `${target.label} recovery changed files beyond the causal source`],
      [!recoveryResult.resolvedBeforeDeploy, `${target.label} recovery marked production resolved before deploy`],
    ]) assert(passed, message);
    return { setup: setupResult, recovery: recoveryResult };
  } finally {
    await close(server);
  }
}

let keepScratch = process.env.VOLATO_KEEP_EVAL === "1";

try {
  const packaged = installPackagedCli();
  const selected = process.argv
    .filter((argument) => argument.startsWith("--target="))
    .map((argument) => argument.slice("--target=".length));
  const names = selected.length > 0 ? selected : Object.keys(targets);
  for (const name of names) assert(targets[name], `unknown framework target: ${name}`);
  const results = {};
  for (const name of names) {
    results[name] = await runTargetCanaries(name, targets[name], packaged);
    process.stdout.write(`✓ ${targets[name].label} natural setup and recovery canaries\n`);
  }
  process.stdout.write(`${JSON.stringify({ cliArtifact: "npm pack", results }, null, 2)}\n`);
} catch (error) {
  keepScratch = true;
  process.stderr.write(
    `${error instanceof Error ? error.stack : String(error)}\nCanary fixtures kept at ${scratch}\n`,
  );
  process.exitCode = 1;
} finally {
  if (!keepScratch) rmSync(scratch, { recursive: true, force: true });
}
