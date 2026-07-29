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
      NO_COLOR: "1",
      npm_config_cache: join(scratch, "npm-cache"),
    },
  });
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
    "skills/volato-nextjs/SKILL.md",
    "skills/volato-nextjs/assets/runtime/server.ts",
    "skills/volato-nextjs/assets/runtime/withVolato.ts",
    "skills/detect-pmf/SKILL.md",
    "skills/detect-pmf/agents/openai.yaml",
    "skills/detect-pmf/references/contract.md",
    "skills/detect-pmf/assets/pmf-tracker.ts",
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
    bundledCli.includes("volato skills install"),
    "packed CLI is missing skill installation",
  );
  assert(
    bundledCli.includes("Generate the dependency-free Volato integration"),
    "packed CLI still exposes the legacy setup surface",
  );
  assert(
    bundledCli.includes("volato pmf validate"),
    "packed CLI is missing the PMF command surface",
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

  run(process.execPath, [cli, "skills", "install"], { cwd: fixture });
  run(
    process.execPath,
    [
      cli,
      "init",
      "--dsn",
      "https://public@api.volato.dev/00000000-0000-4000-8000-000000000001",
      "--yes",
    ],
    { cwd: fixture },
  );

  for (const required of [
    ".agents/skills/volato-setup/SKILL.md",
    ".agents/skills/volato-nextjs/SKILL.md",
    ".agents/skills/detect-pmf/SKILL.md",
    ".agents/skills/detect-pmf/assets/pmf-tracker.ts",
    ".volato/manifest.json",
    "app/error.tsx",
    "instrumentation.ts",
    "volato/server.ts",
  ]) {
    assert(existsSync(join(fixture, required)), `packed CLI did not create ${required}`);
  }
  const fixturePackage = JSON.parse(
    readFileSync(join(fixture, "package.json"), "utf8"),
  );
  assert(
    !Object.keys(fixturePackage.dependencies).some((name) =>
      name.startsWith("@volatodev/"),
    ),
    "volato init added a runtime package dependency",
  );

  process.stdout.write(
    `✓ packed ${packageSpec ?? filename} and exercised skills install + dependency-free init\n`,
  );
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
