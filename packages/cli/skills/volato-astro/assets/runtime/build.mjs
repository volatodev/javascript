import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

function browserBuildValue(name) {
  if (process.env[name]?.trim()) return process.env[name].trim();
  try {
    const line = readFileSync(join(process.cwd(), ".env.local"), "utf8")
      .split(/\r?\n/)
      .find((candidate) => candidate.startsWith(`${name}=`));
    if (!line) return undefined;
    const value = line.slice(name.length + 1).trim();
    return value.replace(/^(?:"([\s\S]*)"|'([\s\S]*)')$/, "$1$2");
  } catch {
    return undefined;
  }
}

function releaseIdentity(explicit) {
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

function objectConfig(value, label) {
  if (value === undefined) return {};
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value;
  }
  throw new Error(`[Volato] Astro ${label} configuration must be one static object.`);
}

function volatoAstroIntegration() {
  return {
    name: "volato-errors-private-astro",
    hooks: {
      "astro:config:setup"({ addMiddleware, injectScript }) {
        addMiddleware({
          entrypoint: new URL("./middleware.mjs", import.meta.url),
          order: "pre",
        });
        const initializer = 'import "/volato-astro/client.mjs";';
        injectScript("before-hydration", initializer);
        injectScript("page", initializer);
      },
    },
  };
}

export function withVolatoAstro(config, options = {}) {
  const release = releaseIdentity(options.release);
  const environment =
    options.environment ??
    browserBuildValue("VITE_VOLATO_ENVIRONMENT") ??
    process.env.NODE_ENV ??
    "production";
  const vite = objectConfig(config.vite, "Vite");
  const define = objectConfig(vite.define, "Vite define");
  const build = objectConfig(vite.build, "Vite build");
  const integrations = config.integrations ?? [];
  if (!Array.isArray(integrations)) {
    throw new Error("[Volato] Astro integrations configuration must be one static array.");
  }
  return {
    ...config,
    integrations: [...integrations, volatoAstroIntegration()],
    vite: {
      ...vite,
      define: {
        ...define,
        __VOLATO_BROWSER_CONFIG__: JSON.stringify({
          dsn: browserBuildValue("VITE_VOLATO_DSN"),
          environment,
          release,
        }),
        __VOLATO_SERVER_RELEASE__: JSON.stringify(release) ?? "undefined",
      },
      build: {
        ...build,
        sourcemap: "hidden",
      },
    },
  };
}
