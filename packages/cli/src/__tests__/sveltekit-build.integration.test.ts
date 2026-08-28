import { execFile } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const assetsRoot = join(
  __dirname,
  "..",
  "..",
  "skills",
  "volato-sveltekit",
  "assets",
  "runtime",
);

let cwd: string;
let server: Server | undefined;

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), "volato-sveltekit-build-"));
});

afterEach(async () => {
  delete process.env.VITE_VOLATO_DSN;
  delete process.env.VITE_VOLATO_ENVIRONMENT;
  delete process.env.VOLATO_RELEASE;
  if (server) {
    await new Promise<void>((resolve) => server!.close(() => resolve()));
    server = undefined;
  }
  rmSync(cwd, { recursive: true, force: true });
});

async function listen(
  status = 202,
): Promise<{ origin: string; bodies: string[]; authorizations: string[] }> {
  const bodies: string[] = [];
  const authorizations: string[] = [];
  server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    request.on("end", () => {
      bodies.push(Buffer.concat(chunks).toString("utf8"));
      authorizations.push(String(request.headers.authorization));
      response.writeHead(status).end();
    });
  });
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("missing address");
  return { origin: `http://127.0.0.1:${address.port}`, bodies, authorizations };
}

function writeMaps(): string[] {
  const maps = [
    join(cwd, "build", "client", "_app", "immutable", "chunks", "app.ABCD1234.js.map"),
    join(cwd, "build", "server", "chunks", "entries", "pages", "boom", "_page.server.ts.XYZ98765.js.map"),
    join(cwd, ".svelte-kit", "output", "server", "entries", "pages", "boom", "_page.server.ts.js.map"),
  ];
  for (const [index, path] of maps.entries()) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(
      path,
      JSON.stringify({
        version: 3,
        file: path.split("/").at(-1)?.replace(/\.map$/, ""),
        sources: [
          index === 0
            ? "../../../../src/routes/+page.svelte"
            : index === 1
              ? "../../../../../../.svelte-kit/output/server/entries/pages/boom/_page.server.ts.js"
              : "../../../../../../src/routes/boom/+page.server.ts",
        ],
        sourcesContent: ["private source body"],
        names: [],
        mappings: "AAAA",
      }),
    );
  }
  return maps;
}

describe("SvelteKit build composition", () => {
  it("preserves config and injects one release without exposing a server token", async () => {
    process.env.VITE_VOLATO_DSN = "https://public@api.volato.dev/project";
    process.env.VITE_VOLATO_ENVIRONMENT = "production";
    process.env.VOLATO_RELEASE = "sveltekit-shared-release";
    const module = await import(
      `${pathToFileURL(join(assetsRoot, "build.mjs")).href}?${Date.now()}`
    );
    const applicationPlugin = { name: "application-plugin" };
    const configFactory = module.withVolatoSvelteKit({
      plugins: [applicationPlugin],
      define: { __APP_FLAG__: "true" },
      build: { minify: false },
    });

    const browser = configFactory({ isSsrBuild: false, mode: "production" });
    const serverConfig = configFactory({ isSsrBuild: true, mode: "production" });

    expect(browser.plugins).toEqual([applicationPlugin]);
    expect(browser.define.__APP_FLAG__).toBe("true");
    expect(browser.build).toMatchObject({ minify: false, sourcemap: "hidden" });
    expect(serverConfig.build).toMatchObject({ minify: false, sourcemap: true });
    expect(serverConfig.define.__VOLATO_SERVER_RELEASE__).toBe(
      '"sveltekit-shared-release"',
    );
    const browserConfig = String(browser.define.__VOLATO_BROWSER_CONFIG__);
    expect(JSON.parse(browserConfig)).toEqual({
      dsn: "https://public@api.volato.dev/project",
      environment: "production",
      release: "sveltekit-shared-release",
    });
    expect(JSON.stringify(browser)).not.toContain("VOLATO_INGEST_TOKEN");
  });
});

describe("SvelteKit client/final-server/intermediate sourcemap uploader", () => {
  it("uploads privacy-cleaned maps under one release and removes every map", async () => {
    const paths = writeMaps();
    const receiver = await listen();

    await execFileAsync(
      process.execPath,
      [join(assetsRoot, "upload-sourcemaps.mjs")],
      {
        cwd,
        env: {
          ...process.env,
          VOLATO_DSN: `http://public@${receiver.origin.slice("http://".length)}/project`,
          VOLATO_INGEST_TOKEN: "private-upload-token",
          VOLATO_RELEASE: "sveltekit-map-release",
        },
      },
    );

    for (const path of paths) expect(() => readFileSync(path)).toThrow();
    expect(receiver.bodies).toHaveLength(3);
    expect(receiver.authorizations).toEqual([
      "Bearer private-upload-token",
      "Bearer private-upload-token",
      "Bearer private-upload-token",
    ]);
    const bodies = receiver.bodies.join("\n");
    expect(bodies).toContain("sveltekit-map-release");
    expect(bodies).toContain("ABCD1234");
    expect(bodies).toContain("_app/immutable/chunks/app.ABCD1234.js");
    expect(bodies).toContain("build/server/chunks/entries/pages/boom/_page.server.ts.XYZ98765.js");
    expect(bodies).toContain(".svelte-kit/output/server/entries/pages/boom/_page.server.ts.js");
    expect(bodies).not.toContain("sourcesContent");
    expect(bodies).not.toContain("private source body");
  });

  it("fails loudly after cleaning all map families when upload is rejected", async () => {
    const paths = writeMaps();
    const receiver = await listen(500);

    await expect(
      execFileAsync(process.execPath, [join(assetsRoot, "upload-sourcemaps.mjs")], {
        cwd,
        env: {
          ...process.env,
          VOLATO_DSN: `http://public@${receiver.origin.slice("http://".length)}/project`,
          VOLATO_INGEST_TOKEN: "private-upload-token",
          VOLATO_RELEASE: "sveltekit-map-release",
        },
      }),
    ).rejects.toThrow(/SvelteKit sourcemap upload failed with HTTP 500/i);
    for (const path of paths) expect(() => readFileSync(path)).toThrow();
  });
});
