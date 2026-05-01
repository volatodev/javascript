import { defineConfig } from "tsup";

export default defineConfig([
  {
    entry: {
      index: "src/index.ts",
      client: "src/client.tsx",
      "error-boundary": "src/error-boundary.tsx",
      server: "src/server.ts",
      middleware: "src/middleware.ts",
      instrumentation: "src/instrumentation.ts",
    },
    format: ["esm"],
    dts: true,
    sourcemap: true,
    clean: true,
    target: "es2022",
    treeshake: true,
    splitting: false,
    minify: false,
    external: ["react", "react-dom", "next"],
  },
  {
    entry: { cli: "src/cli.ts" },
    format: ["esm"],
    dts: false,
    clean: false,
    sourcemap: false,
    target: "es2022",
    minify: false,
    splitting: false,
    noExternal: ["commander", "prompts", "picocolors", "kleur", "sisteransi"],
    banner: { js: "#!/usr/bin/env node" },
  },
]);
