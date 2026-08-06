import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageJsonPath = join(repositoryRoot, "packages", "cli", "package.json");
const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));
const packageSpec = `${packageJson.name}@${packageJson.version}`;
const promoteOnly = process.argv.includes("--promote-only");
const unknownArguments = process.argv.slice(2).filter((arg) => arg !== "--promote-only");
const registryRetryAttempts = 6;
const registryRetryDelayMs = 5_000;

if (unknownArguments.length > 0) {
  throw new Error(`Unknown release argument(s): ${unknownArguments.join(", ")}`);
}

function capture(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: options.cwd ?? repositoryRoot,
    encoding: "utf8",
    env: { ...process.env, NO_COLOR: "1" },
  }).trim();
}

function run(command, args, options = {}) {
  process.stdout.write(`\n==> ${command} ${args.join(" ")}\n`);
  execFileSync(command, args, {
    cwd: options.cwd ?? repositoryRoot,
    env: { ...process.env, ...options.env, NO_COLOR: "1" },
    stdio: "inherit",
  });
}

function wait(milliseconds) {
  Atomics.wait(
    new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT)),
    0,
    0,
    milliseconds,
  );
}

function publishedVersions() {
  const value = JSON.parse(
    capture("npm", ["view", packageJson.name, "versions", "--json"]),
  );
  return Array.isArray(value) ? value : [value];
}

function assertReleaseCheckout() {
  const branch = capture("git", ["branch", "--show-current"]);
  if (branch !== "main") {
    throw new Error(`Release must run from main, not ${branch || "detached HEAD"}.`);
  }

  if (capture("git", ["status", "--porcelain"]) !== "") {
    throw new Error("Release checkout must be clean.");
  }

  run("git", ["fetch", "origin", "main"]);
  const head = capture("git", ["rev-parse", "HEAD"]);
  const remoteMain = capture("git", ["rev-parse", "origin/main"]);
  if (head !== remoteMain) {
    throw new Error("Release checkout must match origin/main exactly.");
  }
}

function verifyVersionWithRetries(spec, label = spec) {
  let lastError;
  for (let attempt = 1; attempt <= registryRetryAttempts; attempt += 1) {
    try {
      const resolvedVersion = capture("npm", ["view", spec, "version"]);
      if (resolvedVersion === packageJson.version) return;
      lastError = new Error(
        `${label} resolves to ${resolvedVersion}, expected ${packageJson.version}.`,
      );
    } catch (error) {
      lastError = error;
    }
    if (attempt < registryRetryAttempts) {
      process.stderr.write(
        `${label} has not propagated yet (attempt ${attempt}/${registryRetryAttempts}); retrying in ${registryRetryDelayMs / 1_000}s…\n`,
      );
      wait(registryRetryDelayMs);
    }
  }
  throw lastError;
}

function verifyTagWithRetries(tag) {
  verifyVersionWithRetries(`${packageJson.name}@${tag}`, tag);
}

assertReleaseCheckout();
run("node", ["scripts/assert-beta-release.mjs", packageJson.version]);
run("npm", ["whoami"]);

const versions = publishedVersions();

if (!promoteOnly) {
  if (versions.includes(packageJson.version)) {
    throw new Error(
      `${packageSpec} is already published. Run pnpm release:promote to resume after publication.`,
    );
  }

  run("pnpm", ["release:check"]);
  run("pnpm", ["--filter", packageJson.name, "publish", "--tag", "beta", "--no-git-checks"]);
} else if (!versions.includes(packageJson.version)) {
  throw new Error(`${packageSpec} is not published and cannot be promoted.`);
}

verifyVersionWithRetries(packageSpec);
run("node", ["scripts/package-smoke.mjs", packageSpec]);
verifyTagWithRetries("beta");
run("node", ["scripts/nextjs-conformance.mjs"], {
  env: { VOLATO_CLI_SPEC: packageSpec },
});
run("node", ["scripts/sync-alpha-dist-tags.mjs"]);
verifyTagWithRetries("latest");

const metadata = capture("npm", [
  "view",
  packageSpec,
  "version",
  "dist.shasum",
  "dist.integrity",
  "--json",
]);

process.stdout.write(`\nPublished and verified ${packageSpec}:\n${metadata}\n`);
