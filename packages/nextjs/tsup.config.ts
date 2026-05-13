import { defineConfig } from "tsup";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const CLIENT_OUTPUTS = [
  "dist/client.js",
  "dist/client.cjs",
  "dist/error-boundary.js",
  "dist/error-boundary.cjs",
];

async function ensureUseClientBanner() {
  for (const rel of CLIENT_OUTPUTS) {
    const file = path.resolve(rel);
    const content = await readFile(file, "utf8");
    if (/^\s*["']use client["']/.test(content)) continue;
    const useStrictMatch = content.match(/^\s*['"]use strict['"];\s*\n?/);
    if (useStrictMatch) {
      const rest = content.slice(useStrictMatch[0].length);
      await writeFile(file, `"use client";\n${useStrictMatch[0]}${rest}`);
    } else {
      await writeFile(file, `"use client";\n${content}`);
    }
  }
}

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
  // Client-side entries. esbuild's treeshake strips bare directive
  // strings from output even when set via `banner`, so we prepend
  // the directive in onSuccess to guarantee it's there.
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
    onSuccess: ensureUseClientBanner,
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
