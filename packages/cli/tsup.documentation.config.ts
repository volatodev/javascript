import { readFileSync } from "node:fs";
import { defineConfig } from "tsup";

const { version } = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf8"),
) as { version: string };

export default defineConfig({
  entry: { contract: "src/documentation/contract.ts" },
  outDir: ".documentation-build",
  format: ["cjs"],
  dts: false,
  clean: true,
  sourcemap: false,
  target: "es2022",
  minify: false,
  splitting: false,
  noExternal: ["commander", "prompts", "picocolors", "kleur", "sisteransi"],
  define: { __CLI_VERSION__: JSON.stringify(version) },
});
