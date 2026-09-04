"use strict";

/**
 * Next.js 16 finishes Turbopack browser sourcemaps after
 * `compiler.runAfterProductionCompile`. This dependency-free postbuild pass
 * uploads that final public set, strips source text before transit, and
 * removes each map only after ingest acknowledges it.
 */

const { execFileSync } = require("node:child_process");
const { readdirSync, statSync } = require("node:fs");
const { readFile, unlink } = require("node:fs/promises");
const {
  basename,
  dirname,
  join,
  relative,
  resolve,
  sep,
} = require("node:path");

const RETRY_DELAYS_MS = [200, 800, 3200];
const UPLOAD_CONCURRENCY = 8;
const REPOSITORY_PREFIX_FIELD = "x_volato_repository_prefix";

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

function hasUsableMappings(parsed) {
  return (
    Array.isArray(parsed.sources) &&
    parsed.sources.length > 0 &&
    typeof parsed.mappings === "string" &&
    parsed.mappings.length > 0
  );
}

function* walkMaps(root) {
  let entries;
  try {
    entries = readdirSync(root);
  } catch {
    return;
  }
  for (const entry of entries) {
    const path = join(root, entry);
    let stats;
    try {
      stats = statSync(path);
    } catch {
      continue;
    }
    if (stats.isDirectory()) yield* walkMaps(path);
    else if (stats.isFile() && path.endsWith(".js.map")) yield path;
  }
}

function parseDsn(value) {
  const url = new URL(value);
  const projectId = url.pathname.replace(/^\/+|\/+$/g, "");
  if (
    (url.protocol !== "https:" && url.protocol !== "http:") ||
    !url.username ||
    url.password ||
    !projectId ||
    projectId.includes("/")
  ) {
    throw new Error("invalid DSN");
  }
  return url.origin;
}

function filenameHash(path) {
  const name = basename(path).replace(/\.map$/, "");
  const webpack = /-([a-zA-Z0-9_-]{8,20})\.js$/.exec(name);
  if (webpack?.[1]) return webpack[1];
  const turbopack = /^([a-zA-Z0-9_-]{8,64})\.js$/.exec(name);
  return turbopack?.[1] ?? null;
}

function git(args, cwd) {
  try {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 1000,
    }).trim();
  } catch {
    return "";
  }
}

function buildIdentity(env, cwd) {
  const explicitRelease = env.VOLATO_RELEASE?.trim();
  const explicitCommit = env.VOLATO_COMMIT_SHA?.trim();
  if (explicitRelease) return { release: explicitRelease, dirty: false };
  if (explicitCommit && /^[a-f0-9]{7,40}$/i.test(explicitCommit)) {
    return { release: explicitCommit, dirty: false };
  }
  const commit = git(["rev-parse", "HEAD"], cwd);
  return {
    release: /^[a-f0-9]{40}$/.test(commit) ? commit : "",
    dirty:
      git(["status", "--porcelain=v1", "--untracked-files=normal"], cwd) !== "",
  };
}

function repositoryPrefix(cwd) {
  const root = git(["rev-parse", "--show-toplevel"], cwd);
  if (!root) return undefined;
  const prefix = relative(root, resolve(cwd)).split(sep).join("/");
  if (!prefix || prefix.startsWith("../")) return undefined;
  return prefix;
}

async function uploadMap({
  mapPath,
  outputRoot,
  endpoint,
  token,
  release,
  prefix,
  fetchImpl,
  warn,
}) {
  const hash = filenameHash(mapPath);
  const displayPath = relative(outputRoot, mapPath)
    .split(sep)
    .join("/")
    .replace(/\.map$/, "");
  if (!hash) {
    warn(
      `Skipping ${displayPath} — its browser chunk name has no stable hash.`,
    );
    return "skipped";
  }

  let sanitized;
  try {
    const parsed = JSON.parse(await readFile(mapPath, "utf8"));
    if (Array.isArray(parsed.sections) && parsed.sections.length > 0) {
      warn(
        `Skipping ${displayPath} — indexed sourcemaps are not resolvable by Volato.`,
      );
      return "skipped";
    }
    if (!hasUsableMappings(parsed)) {
      warn(`Skipping ${displayPath} — empty sourcemap has no mappings.`);
      return "skipped";
    }
    delete parsed.sourcesContent;
    delete parsed[REPOSITORY_PREFIX_FIELD];
    if (prefix) parsed[REPOSITORY_PREFIX_FIELD] = prefix;
    sanitized = JSON.stringify(parsed);
  } catch {
    warn(`Skipping ${displayPath} — sourcemap is not valid JSON.`);
    return "skipped";
  }

  const form = new FormData();
  form.set("release", release);
  form.set("filename_hash", hash);
  form.set("display_path", displayPath);
  form.set(
    "map",
    new Blob([sanitized], { type: "application/json" }),
    `${hash}.map`,
  );

  for (let attempt = 0; ; attempt += 1) {
    let response;
    try {
      response = await fetchImpl(new URL("/api/sourcemaps", endpoint), {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });
    } catch (error) {
      if (attempt < RETRY_DELAYS_MS.length) {
        await sleep(RETRY_DELAYS_MS[attempt]);
        continue;
      }
      warn(
        `Upload of ${displayPath} failed after ${attempt + 1} attempts: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return "failed";
    }

    if (response.status === 200 || response.status === 201) {
      try {
        await unlink(mapPath);
      } catch {
        warn(`Uploaded ${displayPath}, but could not remove its public map.`);
        return "failed";
      }
      return "uploaded";
    }
    if (response.status >= 500 && attempt < RETRY_DELAYS_MS.length) {
      await sleep(RETRY_DELAYS_MS[attempt]);
      continue;
    }
    const body = await response.text().catch(() => "");
    warn(`Upload of ${displayPath} failed: ${response.status} ${body}`.trim());
    return "failed";
  }
}

async function withConcurrency(items, worker) {
  const outcomes = new Array(items.length);
  let next = 0;
  async function consume() {
    while (true) {
      const index = next++;
      if (index >= items.length) return;
      outcomes[index] = await worker(items[index]);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(UPLOAD_CONCURRENCY, items.length) }, consume),
  );
  return outcomes;
}

async function runPostbuild(options = {}) {
  const cwd = options.cwd ?? process.cwd();
  const env = options.env ?? process.env;
  const fetchImpl = options.fetchImpl ?? fetch;
  const warn =
    options.warn ??
    ((message) => {
      console.warn(`[Volato] ${message}`);
    });
  const outputRoot = join(cwd, ".next");
  const maps = [...walkMaps(join(outputRoot, "static"))];
  if (maps.length === 0) return { uploaded: 0, failed: 0 };

  const dsn = env.NEXT_PUBLIC_VOLATO_DSN;
  const token = env.VOLATO_INGEST_TOKEN;
  if (!dsn || !token) {
    warn(
      "Final browser sourcemaps were not uploaded; NEXT_PUBLIC_VOLATO_DSN and VOLATO_INGEST_TOKEN are both required.",
    );
    return { uploaded: 0, failed: maps.length };
  }

  let endpoint;
  try {
    endpoint = parseDsn(dsn);
  } catch {
    warn(
      "Final browser sourcemaps were not uploaded; the Volato DSN is invalid.",
    );
    return { uploaded: 0, failed: maps.length };
  }

  const identity = buildIdentity(env, cwd);
  if (!identity.release) {
    warn(
      "Final browser sourcemaps were not uploaded; no build commit was found.",
    );
    return { uploaded: 0, failed: maps.length };
  }
  if (identity.dirty) {
    await Promise.all(maps.map((mapPath) => unlink(mapPath).catch(() => {})));
    warn(
      "Final browser sourcemaps were not uploaded because the Git-derived release has uncommitted build inputs. Commit them or set VOLATO_RELEASE explicitly.",
    );
    return { uploaded: 0, failed: maps.length };
  }

  const outcomes = await withConcurrency(maps, (mapPath) =>
    uploadMap({
      mapPath,
      outputRoot,
      endpoint,
      token,
      release: identity.release,
      prefix: repositoryPrefix(cwd),
      fetchImpl,
      warn,
    }),
  );
  return {
    uploaded: outcomes.filter((outcome) => outcome === "uploaded").length,
    failed: outcomes.filter((outcome) => outcome === "failed").length,
  };
}

async function runPostbuildCli(options = {}) {
  const warn =
    options.warn ??
    ((message) => {
      console.error(`[Volato] ${message}`);
    });
  try {
    const { failed } = await runPostbuild({ ...options, warn });
    if (failed === 0) return 0;
    warn(
      `${failed} final browser sourcemap(s) could not be uploaded; refusing a green production build.`,
    );
    return 1;
  } catch (error) {
    warn(
      `Final browser sourcemap upload failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return 1;
  }
}

module.exports = { runPostbuild, runPostbuildCli };

if (require.main === module) {
  runPostbuildCli().then((exitCode) => {
    process.exitCode = exitCode;
  });
}
