import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import prompts from "prompts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { installSkills, runSkillsInstall } from "../commands/skills";

let cwd: string;
let sourceRoot: string;

function addSkill(name: string, body: string): void {
  const root = join(sourceRoot, name);
  mkdirSync(join(root, "agents"), { recursive: true });
  writeFileSync(join(root, "SKILL.md"), body);
  writeFileSync(join(root, "agents", "openai.yaml"), "interface: {}\n");
}

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), "volato-skills-"));
  sourceRoot = join(cwd, "bundled");
  addSkill("volato-setup", "generic");
  addSkill("volato-errors", "errors");
  addSkill("volato-nextjs", "next");
  addSkill("volato-vite-react", "vite-react");
  addSkill("volato-vite-vue", "vite-vue");
  addSkill("volato-vite-svelte", "vite-svelte");
  addSkill("volato-node", "node");
  addSkill("volato-fastify", "fastify");
  addSkill("volato-nestjs", "nestjs");
});

afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
});

describe("installSkills", () => {
  it("installs the generic and detected-framework skill set", () => {
    const outcomes = installSkills({ cwd, sourceRoot });

    expect(outcomes.map(({ skill, status }) => ({ skill, status }))).toEqual([
      { skill: "volato-setup", status: "created" },
      { skill: "volato-errors", status: "created" },
      { skill: "volato-nextjs", status: "created" },
      { skill: "volato-vite-react", status: "created" },
      { skill: "volato-vite-vue", status: "created" },
      { skill: "volato-vite-svelte", status: "created" },
      { skill: "volato-node", status: "created" },
      { skill: "volato-fastify", status: "created" },
      { skill: "volato-nestjs", status: "created" },
    ]);
    expect(
      readFileSync(
        join(cwd, ".agents", "skills", "volato-nextjs", "SKILL.md"),
        "utf8",
      ),
    ).toBe("next");
  });

  it("does not install bundled runtime tests into the target repository", () => {
    const runtime = join(
      sourceRoot,
      "volato-nextjs",
      "assets",
      "runtime",
    );
    mkdirSync(join(runtime, "__tests__"), { recursive: true });
    writeFileSync(join(runtime, "client.tsx"), "export {};\n");
    writeFileSync(
      join(runtime, "__tests__", "client.test.ts"),
      'import "esbuild";\n',
    );

    installSkills({ cwd, sourceRoot });

    const installedRuntime = join(
      cwd,
      ".agents",
      "skills",
      "volato-nextjs",
      "assets",
      "runtime",
    );
    expect(existsSync(join(installedRuntime, "client.tsx"))).toBe(true);
    expect(existsSync(join(installedRuntime, "__tests__"))).toBe(false);
    expect(
      installSkills({ cwd, sourceRoot }).map((outcome) => outcome.status),
    ).toEqual([
      "unchanged",
      "unchanged",
      "unchanged",
      "unchanged",
      "unchanged",
      "unchanged",
      "unchanged",
      "unchanged",
      "unchanged",
    ]);
  });

  it("is idempotent", () => {
    installSkills({ cwd, sourceRoot });

    expect(
      installSkills({ cwd, sourceRoot }).map((outcome) => outcome.status),
    ).toEqual([
      "unchanged",
      "unchanged",
      "unchanged",
      "unchanged",
      "unchanged",
      "unchanged",
      "unchanged",
      "unchanged",
      "unchanged",
    ]);
  });

  it("does not overwrite a locally modified skill without force", () => {
    installSkills({ cwd, sourceRoot });
    const installed = join(
      cwd,
      ".agents",
      "skills",
      "volato-setup",
      "SKILL.md",
    );
    writeFileSync(installed, "local edit");

    const outcomes = installSkills({ cwd, sourceRoot });
    expect(outcomes[0]?.status).toBe("conflict");
    expect(readFileSync(installed, "utf8")).toBe("local edit");

    expect(
      installSkills({ cwd, sourceRoot, force: true })[0]?.status,
    ).toBe("updated");
    expect(readFileSync(installed, "utf8")).toBe("generic");
  });

  it.each(["monitor-product-usage", "volato-product"])(
    "removes the retired %s skill only with force",
    (skill) => {
      const retired = join(cwd, ".agents", "skills", skill);
      mkdirSync(retired, { recursive: true });
      writeFileSync(join(retired, "SKILL.md"), "local legacy skill");

      expect(installSkills({ cwd, sourceRoot })[0]).toEqual({
        skill,
        status: "conflict",
        target: retired,
      });
      expect(existsSync(retired)).toBe(true);

      expect(installSkills({ cwd, sourceRoot, force: true })[0]).toEqual({
        skill,
        status: "removed",
        target: retired,
      });
      expect(existsSync(retired)).toBe(false);
    },
  );

  it("offers to update installed skills when bundled files differ", async () => {
    installSkills({ cwd, sourceRoot });
    writeFileSync(
      join(sourceRoot, "volato-setup", "SKILL.md"),
      "updated generic",
    );
    prompts.inject([true]);

    await runSkillsInstall({ cwd, sourceRoot });

    expect(
      readFileSync(
        join(cwd, ".agents", "skills", "volato-setup", "SKILL.md"),
        "utf8",
      ),
    ).toBe("updated generic");
  });

  it("removes files that are no longer part of an updated skill", async () => {
    installSkills({ cwd, sourceRoot });
    rmSync(
      join(sourceRoot, "volato-setup", "agents", "openai.yaml"),
    );
    prompts.inject([true]);

    await runSkillsInstall({ cwd, sourceRoot });

    expect(
      existsSync(
        join(
          cwd,
          ".agents",
          "skills",
          "volato-setup",
          "agents",
          "openai.yaml",
        ),
      ),
    ).toBe(false);
  });

  it("supports a portable target directory", () => {
    installSkills({ cwd, sourceRoot, target: ".claude/skills" });

    expect(
      readFileSync(
        join(cwd, ".claude", "skills", "volato-setup", "SKILL.md"),
        "utf8",
      ),
    ).toBe("generic");
  });

  it("installs a private FastAPI skill only when exact repository evidence selects it", () => {
    addSkill("volato-fastapi", "private-fastapi");
    writeFileSync(join(cwd, ".python-version"), "3.12\n");
    writeFileSync(
      join(cwd, "pyproject.toml"),
      '[project]\nrequires-python = "==3.12.*"\ndependencies = ["fastapi==0.141.1", "starlette==1.6.0", "uvicorn==0.52.4", "pydantic==2.13.5", "anyio==4.14.2"]\n',
    );
    writeFileSync(
      join(cwd, "app.py"),
      "from fastapi import FastAPI\napp = FastAPI()\n",
    );

    const outcomes = installSkills({ cwd, sourceRoot });

    expect(outcomes.at(-1)).toMatchObject({
      skill: "volato-fastapi",
      status: "created",
    });
    expect(
      readFileSync(
        join(cwd, ".agents", "skills", "volato-fastapi", "SKILL.md"),
        "utf8",
      ),
    ).toBe("private-fastapi");
  });

  it("installs the private Nuxt skill only when the exact full-stack tuple is detected", () => {
    addSkill("volato-nuxt", "private-nuxt");
    mkdirSync(join(cwd, "app"), { recursive: true });
    writeFileSync(join(cwd, "app", "app.vue"), "<template><NuxtPage /></template>\n");
    writeFileSync(join(cwd, ".node-version"), "24.19.0\n");
    writeFileSync(
      join(cwd, "package.json"),
      `${JSON.stringify({
        name: "nuxt-private-fixture",
        type: "module",
        engines: { node: "24.19.0" },
        scripts: { build: "nuxt build" },
        dependencies: {
          nuxt: "4.5.2",
          vue: "3.5.42",
          "vue-router": "5.2.0",
        },
      })}\n`,
    );
    writeFileSync(
      join(cwd, "nuxt.config.ts"),
      "export default defineNuxtConfig({ nitro: { preset: 'node-server' } });\n",
    );
    for (const [name, version] of [
      ["nuxt", "4.5.2"],
      ["@nuxt/nitro-server", "4.5.2"],
      ["@nuxt/vite-builder", "4.5.2"],
      ["nitropack", "2.13.4"],
      ["vue", "3.5.42"],
      ["vue-router", "5.2.0"],
      ["vite", "8.2.2"],
    ] as const) {
      const root = join(cwd, "node_modules", ...name.split("/"));
      mkdirSync(root, { recursive: true });
      writeFileSync(join(root, "package.json"), JSON.stringify({ name, version }));
    }

    const outcomes = installSkills({ cwd, sourceRoot });

    expect(outcomes.at(-1)).toMatchObject({
      skill: "volato-nuxt",
      status: "created",
    });
    expect(
      readFileSync(
        join(cwd, ".agents", "skills", "volato-nuxt", "SKILL.md"),
        "utf8",
      ),
    ).toBe("private-nuxt");
  });

  it("installs the private SvelteKit skill only for the exact adapter-node tuple", () => {
    addSkill("volato-sveltekit", "private-sveltekit");
    mkdirSync(join(cwd, "src", "routes"), { recursive: true });
    writeFileSync(join(cwd, "src", "routes", "+page.svelte"), "<h1>Ready</h1>\n");
    writeFileSync(join(cwd, ".node-version"), "24.19.0\n");
    writeFileSync(
      join(cwd, "package.json"),
      `${JSON.stringify({
        name: "sveltekit-private-fixture",
        type: "module",
        engines: { node: "24.19.0" },
        scripts: { build: "vite build" },
        dependencies: {
          svelte: "5.56.10",
          "@sveltejs/kit": "2.70.3",
          "@sveltejs/adapter-node": "5.5.7",
          "@sveltejs/vite-plugin-svelte": "7.3.0",
          vite: "8.2.2",
        },
      })}\n`,
    );
    writeFileSync(
      join(cwd, "vite.config.ts"),
      "import adapter from '@sveltejs/adapter-node';\nimport { sveltekit } from '@sveltejs/kit/vite';\nimport { defineConfig } from 'vite';\nexport default defineConfig({ plugins: [sveltekit({ adapter: adapter() })] });\n",
    );
    for (const [name, version] of [
      ["svelte", "5.56.10"],
      ["@sveltejs/kit", "2.70.3"],
      ["@sveltejs/adapter-node", "5.5.7"],
      ["@sveltejs/vite-plugin-svelte", "7.3.0"],
      ["vite", "8.2.2"],
    ] as const) {
      const root = join(cwd, "node_modules", ...name.split("/"));
      mkdirSync(root, { recursive: true });
      writeFileSync(join(root, "package.json"), JSON.stringify({ name, version }));
    }

    const outcomes = installSkills({ cwd, sourceRoot });

    expect(outcomes.at(-1)).toMatchObject({
      skill: "volato-sveltekit",
      status: "created",
    });
    expect(
      readFileSync(
        join(cwd, ".agents", "skills", "volato-sveltekit", "SKILL.md"),
        "utf8",
      ),
    ).toBe("private-sveltekit");
  });
});
