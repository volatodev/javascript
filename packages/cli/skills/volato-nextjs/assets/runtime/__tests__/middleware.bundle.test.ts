import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { beforeAll, describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const entryPath = resolve(__dirname, "../middleware.ts");

let bundle = "";

describe("bundle hygiene (dist/middleware.js)", () => {
  beforeAll(async () => {
    const result = await build({
      entryPoints: [entryPath],
      bundle: true,
      format: "esm",
      platform: "browser",
      target: "es2022",
      external: ["node:async_hooks"],
      write: false,
    });
    bundle = result.outputFiles[0]?.text ?? "";
  });

  it("contains no `node:` imports beyond the Edge-supported subset", () => {
    // The Next.js Edge runtime allows a small subset of `node:` modules
    // (notably `node:async_hooks` for AsyncLocalStorage scope isolation,
    // since Next 13.4). Anything else must stay out of the bundle.
    const ALLOWED_NODE_IMPORTS = new Set(["node:async_hooks"]);
    const matches = bundle.match(/node:[a-zA-Z_/]+/g) ?? [];
    const offenders = matches.filter((m) => !ALLOWED_NODE_IMPORTS.has(m));
    expect(offenders).toEqual([]);
  });

  it("does not import disallowed Node built-ins, even as bare specifiers", () => {
    // tsup strips the `node:` prefix on emit, so `node:fs` ships as a
    // bare `fs` import the `node:`-only check above cannot see. Scan for
    // both forms of every builtin the Edge runtime can't provide.
    const FORBIDDEN = [
      "fs",
      "fs/promises",
      "child_process",
      "net",
      "tls",
      "dns",
      "http",
      "https",
      "crypto",
      "os",
      "stream",
      "zlib",
      "worker_threads",
      "cluster",
      "module",
      "vm",
    ];
    const offenders = FORBIDDEN.filter((m) => {
      const esc = m.replace(/\//g, "\\/");
      const re = new RegExp(
        `(?:import[^;]*from\\s*|require\\(\\s*|import\\(\\s*)["'](?:node:)?${esc}["']`,
      );
      return re.test(bundle);
    });
    expect(offenders).toEqual([]);
  });

  it("does not reference Buffer", () => {
    expect(bundle).not.toMatch(/Buffer/);
  });

  it("does not read process.env (config must be passed explicitly)", () => {
    expect(bundle).not.toMatch(/process\.env/);
  });

  it("does not use CommonJS require(", () => {
    expect(bundle).not.toMatch(/require\(/);
  });
});
