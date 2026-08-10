import { execFileSync } from "node:child_process";
import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join, relative } from "node:path";
import { loadEnv, type Plugin, type UserConfig } from "vite";

type VolatoViteOptions = {
  release?: string;
  environment?: string;
};

function detectRelease(explicit?: string): string | undefined {
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

function parseDsn(dsn: string): { endpoint: string } {
  const url = new URL(dsn);
  if (!/^https?:$/.test(url.protocol) || !url.username || url.password) {
    throw new Error("Invalid VITE_VOLATO_DSN");
  }
  return { endpoint: `${url.origin}/api/sourcemaps` };
}

async function uploadMaps(args: {
  outDir: string;
  dsn?: string;
  ingestToken?: string;
  release?: string;
}): Promise<void> {
  const paths = mapsUnder(args.outDir);
  for (const path of paths) {
    const raw = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    delete raw.sourcesContent;
    const sanitized = `${JSON.stringify(raw)}\n`;
    writeFileSync(path, sanitized, "utf8");
    const filenameHash = mapKey(path);
    if (!filenameHash) {
      throw new Error(`[Volato] Vite emitted an unaddressable sourcemap: ${path}`);
    }
    if (!args.dsn || !args.ingestToken || !args.release) continue;
    const form = new FormData();
    form.set("release", args.release);
    form.set("filename_hash", filenameHash);
    form.set(
      "display_path",
      relative(args.outDir, path).replaceAll("\\", "/").replace(/\.map$/, ""),
    );
    form.set("map", new Blob([sanitized], { type: "application/json" }), "map.json");
    const response = await fetch(parseDsn(args.dsn).endpoint, {
      method: "POST",
      headers: { Authorization: `Bearer ${args.ingestToken}` },
      body: form,
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      throw new Error(`[Volato] Sourcemap upload failed with HTTP ${response.status}.`);
    }
  }
  if (paths.length > 0 && (!args.ingestToken || !args.dsn || !args.release)) {
    console.warn(
      "[Volato] Sourcemaps were privacy-cleaned but not uploaded. Set VOLATO_INGEST_TOKEN and VITE_VOLATO_DSN in CI and ensure a Git release is available.",
    );
  }
}

export function withVolato(
  config: UserConfig,
  options: VolatoViteOptions = {},
): UserConfig {
  let outDir = "dist";
  let dsn: string | undefined;
  let ingestToken: string | undefined;
  const release = detectRelease(options.release);
  const plugin: Plugin = {
    name: "volato-errors",
    apply: "build",
    config(_current, env) {
      const loaded = loadEnv(env.mode, process.cwd(), "");
      dsn = loaded.VITE_VOLATO_DSN;
      ingestToken = loaded.VOLATO_INGEST_TOKEN;
      return {
        define: {
          "import.meta.env.VITE_VOLATO_RELEASE": JSON.stringify(release ?? ""),
          "import.meta.env.VITE_VOLATO_ENVIRONMENT": JSON.stringify(
            options.environment ?? loaded.VITE_VOLATO_ENVIRONMENT ?? env.mode,
          ),
        },
        build: { sourcemap: true },
      };
    },
    configResolved(resolved) {
      outDir = resolved.build.outDir;
    },
    async closeBundle() {
      await uploadMaps({ outDir, dsn, ingestToken, release });
    },
  };
  return {
    ...config,
    build: { ...config.build, sourcemap: true },
    plugins: [...(Array.isArray(config.plugins) ? config.plugins : []), plugin],
  };
}
