import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageRoot = join(repositoryRoot, "packages", "cli");
const npmCache = mkdtempSync(join(tmpdir(), "volato-release-check-npm-"));

const checks = [
  ["pnpm", ["lint"], repositoryRoot],
  ["pnpm", ["typecheck"], repositoryRoot],
  ["pnpm", ["test"], repositoryRoot],
  ["pnpm", ["build"], repositoryRoot],
  ["pnpm", ["audit", "--prod", "--audit-level", "high"], repositoryRoot],
  ["pnpm", ["smoke:package"], repositoryRoot],
  ["pnpm", ["smoke:nextjs"], repositoryRoot],
  ["npm", ["pack", "--dry-run"], packageRoot],
];

try {
  for (const [command, args, cwd] of checks) {
    process.stdout.write(`\n==> ${command} ${args.join(" ")}\n`);
    execFileSync(command, args, {
      cwd,
      env: {
        ...process.env,
        NO_COLOR: "1",
        npm_config_cache: npmCache,
      },
      stdio: "inherit",
    });
  }

  process.stdout.write("\nRelease candidate passed every local gate.\n");
} finally {
  rmSync(npmCache, { recursive: true, force: true });
}
