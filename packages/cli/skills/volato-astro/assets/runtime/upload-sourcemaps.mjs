import { execFileSync } from "node:child_process";
import {
  existsSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
} from "node:fs";
import { basename, join, relative } from "node:path";

const outputRoot = "dist";

function mapsUnder(root) {
  if (!existsSync(root)) return [];
  return readdirSync(root).flatMap((name) => {
    const path = join(root, name);
    return statSync(path).isDirectory()
      ? mapsUnder(path)
      : /\.(?:c|m)?js\.map$/.test(path)
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

function browserHash(path) {
  const stem = basename(path)
    .replace(/\.map$/, "")
    .replace(/\.(?:c|m)?js$/, "");
  if (!stem.includes(".") && /^[a-zA-Z0-9_-]{8,32}$/.test(stem)) return stem;
  return (
    stem
      .split(".")
      .reverse()
      .find((part) => /^[a-zA-Z0-9_-]{8,32}$/.test(part)) ?? null
  );
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
    return (
      execFileSync("git", ["status", "--porcelain=v1", "--untracked-files=normal"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim() === ""
    );
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

const clientRoot = join(outputRoot, "client");
const serverRoot = join(outputRoot, "server");
const paths = mapsUnder(outputRoot).sort();
const identity = releaseIdentity();
const dirty = Boolean(
  identity.release && identity.inferredFromGit && !gitWorktreeIsClean(),
);
const dsn = process.env.VOLATO_DSN;
const token = process.env.VOLATO_INGEST_TOKEN;
let uploaded = 0;

try {
  for (const path of paths) {
    const raw = JSON.parse(readFileSync(path, "utf8"));
    delete raw.sourcesContent;
    const sanitized = `${JSON.stringify(raw)}\n`;
    const inClient = relative(clientRoot, path).split(/[\\/]/)[0] !== "..";
    const inServer = relative(serverRoot, path).split(/[\\/]/)[0] !== "..";
    if (!inClient && !inServer) {
      throw new Error(`[Volato] Astro emitted a sourcemap outside dist/client or dist/server: ${path}.`);
    }
    const displayPath = (inClient ? relative(clientRoot, path) : relative(outputRoot, path))
      .replaceAll("\\", "/")
      .replace(/\.map$/, "");
    const filenameHash = inClient ? browserHash(path) : stablePathHash(displayPath);
    if (!filenameHash) {
      throw new Error(`[Volato] Astro emitted an unaddressable browser sourcemap: ${path}.`);
    }
    if (!dsn || !token || !identity.release || dirty) continue;
    const form = new FormData();
    form.set("release", identity.release);
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
      throw new Error(`[Volato] Astro sourcemap upload failed with HTTP ${response.status}.`);
    }
    uploaded += 1;
  }
} finally {
  for (const path of paths) rmSync(path, { force: true });
}

if (paths.length > 0 && dirty) {
  console.warn(
    "[Volato] Astro sourcemaps were removed but not uploaded because the release was inferred from Git and the worktree has uncommitted changes. Commit the build inputs or set VOLATO_RELEASE explicitly for this build.",
  );
} else if (paths.length > 0 && (!dsn || !token || !identity.release)) {
  console.warn(
    "[Volato] Astro sourcemaps were removed but not uploaded. Set VOLATO_DSN, VOLATO_INGEST_TOKEN and VOLATO_RELEASE in CI.",
  );
} else if (uploaded !== paths.length) {
  throw new Error(`[Volato] Astro uploaded ${uploaded}/${paths.length} sourcemaps.`);
} else if (paths.length > 0) {
  console.log(
    `[Volato] Uploaded ${paths.length} privacy-cleaned Astro sourcemap(s) for ${identity.release}.`,
  );
}
