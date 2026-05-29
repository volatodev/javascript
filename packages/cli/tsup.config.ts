import { readFileSync } from "node:fs";
import { defineConfig } from "tsup";

// Inline the package version at build time so `volato --version` works
// from the bundled binary without reading package.json at runtime
// (which isn't shipped next to dist/cli.cjs in a predictable place).
const { version } = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf8"),
) as { version: string };

// Single-file CJS bundle. Commander v14 internally `require`s `events`
// at runtime, which trips the ESM "Dynamic require of …" wall when the
// CLI is launched as ESM — CJS sidesteps the whole class of issues at
// zero runtime cost. Output extension stays `.cjs` so the `bin` entry
// in package.json doesn't depend on Node's module resolution to pick
// the right loader.
export default defineConfig({
  entry: { cli: "src/cli.ts" },
  format: ["cjs"],
  dts: false,
  clean: true,
  sourcemap: false,
  target: "es2022",
  minify: false,
  splitting: false,
  noExternal: ["commander", "prompts", "picocolors", "kleur", "sisteransi"],
  define: { __CLI_VERSION__: JSON.stringify(version) },
  banner: { js: "#!/usr/bin/env node" },
});
