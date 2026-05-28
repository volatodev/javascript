import { defineConfig } from "tsup";

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
  banner: { js: "#!/usr/bin/env node" },
});
