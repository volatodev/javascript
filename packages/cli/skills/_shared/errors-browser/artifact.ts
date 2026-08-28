import { execFileSync } from "node:child_process";
import {
  existsSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join, relative } from "node:path";

export function detectVolatoRelease(explicit?: string): string | undefined {
  if (explicit?.trim()) return explicit.trim();
  if (process.env.VOLATO_RELEASE?.trim()) return process.env.VOLATO_RELEASE.trim();
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return undefined;
  }
}

export function volatoReleaseIsExplicit(explicit?: string): boolean {
  return Boolean(explicit?.trim() || process.env.VOLATO_RELEASE?.trim());
}

function gitWorktreeIsClean(root: string): boolean {
  try {
    return (
      execFileSync(
        "git",
        ["status", "--porcelain=v1", "--untracked-files=normal"],
        {
          cwd: root,
          encoding: "utf8",
          stdio: ["ignore", "pipe", "ignore"],
        },
      ).trim() === ""
    );
  } catch {
    return false;
  }
}

function mapsUnder(root: string): string[] {
  if (!existsSync(root)) return [];
  return readdirSync(root).flatMap((name) => {
    const path = join(root, name);
    return statSync(path).isDirectory()
      ? mapsUnder(path)
      : path.endsWith(".js.map")
        ? [path]
        : [];
  });
}

function mapKey(path: string): string | null {
  return /-([a-zA-Z0-9_-]{8,20})\.js\.map$/.exec(path)?.[1] ?? null;
}

function sourcemapEndpoint(dsn: string): string {
  const url = new URL(dsn);
  if (!/^https?:$/.test(url.protocol) || !url.username || url.password) {
    throw new Error("Invalid Volato browser DSN");
  }
  return `${url.origin}/api/sourcemaps`;
}

export async function uploadVolatoBrowserSourceMaps(args: {
  adapter: "Vite" | "Webpack" | "Rspack" | "Angular";
  outDir: string;
  projectRoot: string;
  dsn?: string;
  ingestToken?: string;
  release?: string;
  releaseWasExplicit?: boolean;
}): Promise<void> {
  const paths = mapsUnder(args.outDir);
  const dirty = Boolean(
    args.release &&
      !args.releaseWasExplicit &&
      !gitWorktreeIsClean(args.projectRoot),
  );
  let uploaded = 0;
  try {
    for (const path of paths) {
      const raw = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
      delete raw.sourcesContent;
      const sanitized = `${JSON.stringify(raw)}\n`;
      writeFileSync(path, sanitized, "utf8");
      const filenameHash = mapKey(path);
      if (!filenameHash) {
        throw new Error(
          `[Volato] ${args.adapter} emitted an unaddressable sourcemap: ${path}. Use a -[contenthash:8] JavaScript filename.`,
        );
      }
      if (!args.dsn || !args.ingestToken || !args.release || dirty) continue;
      const form = new FormData();
      form.set("release", args.release);
      form.set("filename_hash", filenameHash);
      form.set(
        "display_path",
        relative(args.outDir, path).replaceAll("\\", "/").replace(/\.map$/, ""),
      );
      form.set("map", new Blob([sanitized], { type: "application/json" }), "map.json");
      const response = await fetch(sourcemapEndpoint(args.dsn), {
        method: "POST",
        headers: { Authorization: `Bearer ${args.ingestToken}` },
        body: form,
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) {
        throw new Error(
          `[Volato] ${args.adapter} sourcemap upload failed with HTTP ${response.status}.`,
        );
      }
      uploaded += 1;
    }
  } finally {
    for (const path of paths) rmSync(path, { force: true });
  }
  if (paths.length > 0 && dirty) {
    console.warn(
      "[Volato] Browser sourcemaps were removed but not uploaded because the release was inferred from Git and the worktree has uncommitted changes. Commit the build inputs or set VOLATO_RELEASE explicitly for this build.",
    );
  } else if (
    paths.length > 0 &&
    (!args.ingestToken || !args.dsn || !args.release)
  ) {
    console.warn(
      "[Volato] Browser sourcemaps were removed but not uploaded. Set VOLATO_INGEST_TOKEN and the adapter DSN in CI and ensure a Git release is available.",
    );
  } else if (paths.length > 0 && uploaded !== paths.length) {
    throw new Error(
      `[Volato] ${args.adapter} uploaded ${uploaded}/${paths.length} browser sourcemaps.`,
    );
  }
}
