import { DefinePlugin, type Compiler, type Configuration } from "@rspack/core";
import {
  detectVolatoRelease,
  uploadVolatoBrowserSourceMaps,
  volatoReleaseIsExplicit,
} from "./artifact";

type VolatoRspackOptions = {
  release?: string;
  environment?: string;
};

class VolatoRspackSourceMapsPlugin {
  constructor(
    private readonly options: VolatoRspackOptions,
    private readonly release: string | undefined,
  ) {}

  apply(compiler: Compiler): void {
    compiler.hooks.afterEmit.tapPromise("VolatoErrorsSourceMaps", async () => {
      await uploadVolatoBrowserSourceMaps({
        adapter: "Rspack",
        outDir: compiler.outputPath,
        projectRoot: compiler.context,
        dsn: process.env.VOLATO_DSN,
        ingestToken: process.env.VOLATO_INGEST_TOKEN,
        release: this.release,
        releaseWasExplicit: volatoReleaseIsExplicit(this.options.release),
      });
    });
  }
}

export function withVolatoRspack(
  config: Configuration,
  options: VolatoRspackOptions = {},
): Configuration {
  const release = detectVolatoRelease(options.release);
  const environment = options.environment ?? process.env.NODE_ENV ?? "production";
  return {
    ...config,
    devtool: "source-map",
    output: {
      ...config.output,
      filename: config.output?.filename ?? "[name]-[contenthash:8].js",
      chunkFilename: config.output?.chunkFilename ?? "[name]-[contenthash:8].js",
    },
    plugins: [
      ...(config.plugins ?? []),
      new DefinePlugin({
        __VOLATO_BROWSER_CONFIG__: JSON.stringify({
          dsn: process.env.VOLATO_DSN,
          environment,
          release,
        }),
      }),
      new VolatoRspackSourceMapsPlugin(options, release),
    ],
  };
}
