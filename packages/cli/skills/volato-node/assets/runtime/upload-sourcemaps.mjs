import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, join, relative } from "node:path";

const outputRoot = process.argv[2] ?? "dist";

function filesUnder(root) {
  if (!existsSync(root)) return [];
  return readdirSync(root).flatMap((name) => {
    const path = join(root, name);
    return statSync(path).isDirectory()
      ? filesUnder(path)
      : path.endsWith(".js.map") || path.endsWith(".mjs.map") || path.endsWith(".cjs.map")
        ? [path]
        : [];
  });
}

function stablePathHash(path) {
  let hash = 0xcbf29ce484222325n;
  for (const character of path) {
    hash ^= BigInt(character.codePointAt(0) ?? 0);
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return `p${hash.toString(16).padStart(16, "0").slice(-15)}`;
}

function releaseIdentity() {
  if (process.env.VOLATO_RELEASE?.trim()) {
    return { release: process.env.VOLATO_RELEASE.trim(), inferredFromGit: false };
  }
  try {
    return {
      release: execFileSync("git", ["rev-parse", "HEAD"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim(),
      inferredFromGit: true,
    };
  } catch {
    return { release: undefined, inferredFromGit: false };
  }
}

function gitWorktreeIsClean() {
  try {
    return execFileSync(
      "git",
      ["status", "--porcelain=v1", "--untracked-files=normal"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    ).trim() === "";
  } catch {
    return false;
  }
}

function endpointFromDsn(dsn) {
  const url = new URL(dsn);
  if (!/^https?:$/.test(url.protocol) || !url.username || url.password) {
    throw new Error("Invalid VOLATO_DSN");
  }
  return `${url.origin}/api/sourcemaps`;
}

const dsn = process.env.VOLATO_DSN;
const token = process.env.VOLATO_INGEST_TOKEN;
const identity = releaseIdentity();
const release = identity.release;
const paths = filesUnder(outputRoot);
const maps = paths.map((path) => {
  const raw = JSON.parse(readFileSync(path, "utf8"));
  delete raw.sourcesContent;
  const sanitized = `${JSON.stringify(raw)}\n`;
  writeFileSync(path, sanitized, "utf8");
  return { path, sanitized };
});
if (paths.length > 0 && identity.inferredFromGit && !gitWorktreeIsClean()) {
  console.warn(
    "[Volato] Node sourcemaps were privacy-cleaned but not uploaded because the release was inferred from Git but the worktree has uncommitted changes. Commit the build inputs or set VOLATO_RELEASE explicitly for this build.",
  );
  process.exit(0);
}
if (paths.length > 0 && (!dsn || !token || !release)) {
  console.warn(
    "[Volato] Node sourcemaps were not uploaded. Set VOLATO_DSN, VOLATO_INGEST_TOKEN, and VOLATO_RELEASE in CI.",
  );
  process.exit(0);
}

for (const { path, sanitized } of maps) {
  const displayPath = relative(process.cwd(), path)
    .replaceAll("\\", "/")
    .replace(/\.map$/, "");
  const embeddedHash = /-([a-zA-Z0-9_-]{8,20})\.[cm]?js$/.exec(displayPath)?.[1];
  const filenameHash = embeddedHash ?? stablePathHash(displayPath);
  const form = new FormData();
  form.set("release", release);
  form.set("filename_hash", filenameHash);
  form.set("display_path", displayPath);
  form.set("map", new Blob([sanitized], { type: "application/json" }), basename(path));
  const response = await fetch(endpointFromDsn(dsn), {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    throw new Error(`[Volato] Node sourcemap upload failed with HTTP ${response.status}.`);
  }
}

if (paths.length > 0) {
  console.log(`[Volato] Uploaded ${paths.length} privacy-cleaned Node sourcemap(s) for ${release}.`);
}
