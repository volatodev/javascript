import { stat, readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const distPath = resolve(__dirname, "../../dist/middleware.js");

let bundle = "";

describe("bundle hygiene (dist/middleware.js)", () => {
  beforeAll(async () => {
    try {
      await stat(distPath);
    } catch {
      throw new Error(
        `Missing ${distPath}. Run \`pnpm build --filter=@volatodev/nextjs\` before \`pnpm test\`.`,
      );
    }
    bundle = await readFile(distPath, "utf8");
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
