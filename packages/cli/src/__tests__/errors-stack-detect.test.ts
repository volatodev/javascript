import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), "volato-errors-detect-"));
});

afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
});

describe("detectErrorsStack", () => {
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

  it("announces an unsupported Node HTTP framework even without a conventional server entry", () => {
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

    const result = detectErrorsStack(cwd);

    expect(result.viteReact).toBeDefined();
    expect(result.node).toBeUndefined();
    expect(result.notices).toContainEqual(
      expect.stringMatching(/fastify.*not supported.*server.*not modified/i),
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
