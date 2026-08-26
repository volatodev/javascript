import { loadEnv, type Plugin, type UserConfig } from "vite";
import {
  detectVolatoRelease,
  uploadVolatoBrowserSourceMaps,
  volatoReleaseIsExplicit,
} from "./artifact";

type VolatoViteOptions = {
  release?: string;
  environment?: string;
};

export function withVolato(
  config: UserConfig,
  options: VolatoViteOptions = {},
): UserConfig {
  let outDir = "dist";
  let projectRoot = process.cwd();
  let dsn: string | undefined;
  let ingestToken: string | undefined;
  const release = detectVolatoRelease(options.release);
  const plugin: Plugin = {
    name: "volato-errors",
    apply: "build",
    config(_current, env) {
      const loaded = loadEnv(env.mode, process.cwd(), "");
      dsn = loaded.VITE_VOLATO_DSN;
      ingestToken = loaded.VOLATO_INGEST_TOKEN;
      const environment =
        options.environment ?? loaded.VITE_VOLATO_ENVIRONMENT ?? env.mode;
      return {
        define: {
          __VOLATO_BROWSER_CONFIG__: JSON.stringify({
            dsn,
            environment,
            release,
          }),
        },
        build: { sourcemap: true },
      };
    },
    configResolved(resolved) {
      outDir = resolved.build.outDir;
      projectRoot = resolved.root;
    },
    async closeBundle() {
      await uploadVolatoBrowserSourceMaps({
        adapter: "Vite",
        outDir,
        projectRoot,
        dsn,
        ingestToken,
        release,
        releaseWasExplicit: volatoReleaseIsExplicit(options.release),
      });
    },
  };
  return {
    ...config,
    build: { ...config.build, sourcemap: true },
    plugins: [...(Array.isArray(config.plugins) ? config.plugins : []), plugin],
  };
}
