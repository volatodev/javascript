import { defineConfig } from "tsup";

export default defineConfig([
  // Server-side entries — no "use client" directive needed.
  {
    entry: {
      index: "src/index.ts",
      server: "src/server.ts",
      middleware: "src/middleware.ts",
      instrumentation: "src/instrumentation.ts",
    },
    format: ["esm", "cjs"],
    dts: true,
    sourcemap: true,
    clean: true,
    target: "es2022",
    treeshake: true,
    splitting: false,
    minify: false,
    external: ["react", "react-dom", "next"],
  },
  // Client-side entries — preserve the "use client" directive that
  // tsup/esbuild strips during bundling.
  {
    entry: {
      client: "src/client.tsx",
      "error-boundary": "src/error-boundary.tsx",
    },
    format: ["esm", "cjs"],
    dts: true,
    sourcemap: true,
    clean: false,
    target: "es2022",
    treeshake: true,
    splitting: false,
    minify: false,
    external: ["react", "react-dom", "next"],
    banner: { js: '"use client";' },
  },
  // CLI bundle — shebang for direct `node` execution.
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
