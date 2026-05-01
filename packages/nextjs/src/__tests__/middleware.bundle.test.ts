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

  it("contains no `node:` imports (Edge runtime forbids Node built-ins)", () => {
    expect(bundle).not.toMatch(/node:/);
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
