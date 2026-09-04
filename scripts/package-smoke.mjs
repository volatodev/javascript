import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cliRoot = join(repositoryRoot, "packages", "cli");
const scratch = mkdtempSync(join(tmpdir(), "volato-package-smoke-"));
const packageSpec = process.argv[2];

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? repositoryRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      ...options.env,
      NO_COLOR: "1",
      npm_config_cache: join(scratch, "npm-cache"),
    },
  });
  if (result.error) {
    throw new Error(
      `${command} ${args.join(" ")} could not start: ${result.error.message}`,
    );
  }
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed\n${result.stdout}\n${result.stderr}`,
    );
  }
  return result.stdout;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

try {
  const packArgs = packageSpec
    ? [
        "pack",
        packageSpec,
        "--ignore-scripts",
        "--pack-destination",
        scratch,
      ]
    : [
        "pack",
        "--ignore-scripts",
        "--pack-destination",
        scratch,
      ];
  run(
    "npm",
    packArgs,
    { cwd: packageSpec ? repositoryRoot : cliRoot },
  );
  const filename = readdirSync(scratch).find((name) => name.endsWith(".tgz"));
  assert(filename, "npm pack returned no archive");
  const archive = join(scratch, filename);
  const paths = new Set(
    run("tar", ["-tzf", archive])
      .split(/\r?\n/)
      .filter(Boolean)
      .map((path) => path.replace(/^package\//, "")),
  );

  for (const required of [
    "dist/cli.cjs",
    "skills/volato-setup/SKILL.md",
    "skills/volato-errors/SKILL.md",
    "skills/volato-errors/agents/openai.yaml",
    "skills/volato-errors/references/investigation.md",
    "skills/volato-nextjs/SKILL.md",
    "skills/volato-nextjs/assets/runtime/server.ts",
    "skills/volato-nextjs/assets/runtime/withVolato.ts",
    "skills/volato-vite-react/SKILL.md",
    "skills/volato-vite-vue/SKILL.md",
    "skills/volato-vite-vue/agents/openai.yaml",
    "skills/volato-vite-svelte/SKILL.md",
    "skills/volato-vite-svelte/agents/openai.yaml",
    "skills/_shared/errors-browser/browser.ts",
    "skills/_shared/errors-browser/react.tsx",
    "skills/_shared/errors-browser/vue.ts",
    "skills/_shared/errors-browser/svelte.ts",
    "skills/_shared/errors-browser/artifact.ts",
    "skills/_shared/errors-browser/vite.ts",
    "skills/_shared/errors-browser/webpack.ts",
    "skills/_shared/errors-browser/rspack.ts",
    "skills/volato-node/SKILL.md",
    "skills/volato-fastify/SKILL.md",
    "skills/volato-fastify/agents/openai.yaml",
    "skills/volato-nestjs/SKILL.md",
    "skills/volato-nestjs/agents/openai.yaml",
    "skills/volato-node/assets/runtime/node.ts",
    "skills/volato-node/assets/runtime/express.ts",
    "skills/volato-node/assets/runtime/fastify.ts",
    "skills/volato-node/assets/runtime/nestjs.ts",
    "skills/volato-node/assets/runtime/upload-sourcemaps.mjs",
  ]) {
    assert(paths.has(required), `packed CLI is missing ${required}`);
  }
  assert(
    ![...paths].some((path) => path.includes("/__tests__/")),
    "packed CLI must not ship runtime test fixtures",
  );
  assert(
    ![...paths].some((path) => /(^|\/)\.env(?:\.|$)/.test(path)),
    "packed CLI must not contain environment files",
  );

  run("tar", ["-xzf", archive, "-C", scratch]);
  const packageRoot = join(scratch, "package");
  const cli = join(packageRoot, "dist", "cli.cjs");
  assert(existsSync(cli), "packed CLI executable was not extracted");

  const bundledCli = readFileSync(cli, "utf8");
  assert(
    bundledCli.includes("Install Volato operational and framework skills"),
    "packed CLI is missing skill installation",
  );
  assert(
    bundledCli.includes("Link this repository to a Volato project"),
    "packed CLI is missing the neutral repository bootstrap",
  );
  assert(
    bundledCli.includes("volato errors init"),
    "packed CLI is missing the Errors installation surface",
  );
  assert(
    bundledCli.includes("node.cjs") &&
      bundledCli.includes("installFatalHandlers"),
    "packed CLI is missing generated CommonJS Node capture",
  );
  const publicHelp = run(process.execPath, [cli, "--help"]);
  assert(
    !publicHelp.includes("analytics"),
    "packed CLI exposes the retired Product command surface",
  );
  assert(
    ![...paths].some((path) => path.startsWith("skills/volato-product/")),
    "packed CLI still contains the retired Product skill",
  );

  const fixture = join(scratch, "fixture");
  mkdirSync(join(fixture, "app"), { recursive: true });
  writeFileSync(
    join(fixture, "package.json"),
    `${JSON.stringify(
      {
        name: "volato-package-smoke-fixture",
        private: true,
        dependencies: {
          next: "^15.5.18",
          react: "^19.0.0",
          "react-dom": "^19.0.0",
        },
      },
      null,
      2,
    )}\n`,
  );
  writeFileSync(
    join(fixture, "app", "layout.tsx"),
    "export default function Layout({ children }) { return <html><body>{children}</body></html>; }\n",
  );
  writeFileSync(join(fixture, "next.config.ts"), "export default {};\n");
  writeFileSync(join(fixture, ".gitignore"), ".env*.local\n");
  for (const retired of ["monitor-product-usage", "volato-product"]) {
    const retiredRoot = join(fixture, ".agents", "skills", retired);
    mkdirSync(retiredRoot, { recursive: true });
    writeFileSync(join(retiredRoot, "SKILL.md"), "legacy skill\n");
  }

  run(process.execPath, [cli, "skills", "install", "--force"], {
    cwd: fixture,
  });
  for (const required of [
    ".agents/skills/volato-setup/SKILL.md",
    ".agents/skills/volato-errors/SKILL.md",
    ".agents/skills/volato-nextjs/SKILL.md",
  ]) {
    assert(existsSync(join(fixture, required)), `packed CLI did not create ${required}`);
  }
  for (const unrelated of [
    "volato-vite-react",
    "volato-vite-vue",
    "volato-vite-svelte",
    "volato-node",
    "volato-fastify",
    "volato-nestjs",
  ]) {
    assert(
      !existsSync(join(fixture, ".agents", "skills", unrelated)),
      `packed CLI installed unrelated skill ${unrelated}`,
    );
  }
  assert(
    !existsSync(join(fixture, ".agents", "skills", "volato-nextjs", "assets")),
    "packed CLI installed runtime assets with the Next.js agent skill",
  );
  for (const retired of ["monitor-product-usage", "volato-product"]) {
    assert(
      !existsSync(join(fixture, ".agents", "skills", retired)),
      `packed CLI did not remove retired skill ${retired}`,
    );
  }
  const fixturePackage = JSON.parse(
    readFileSync(join(fixture, "package.json"), "utf8"),
  );
  assert(
    !Object.keys(fixturePackage.dependencies).some((name) =>
      name.startsWith("@volatodev/"),
    ),
    "volato skills install added a runtime package dependency",
  );

  process.stdout.write(
    `✓ packed ${packageSpec ?? filename} and exercised the agent skill catalog\n`,
  );
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
