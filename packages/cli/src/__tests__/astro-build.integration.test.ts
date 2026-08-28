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
  "volato-astro",
  "assets",
  "runtime",
);

let cwd: string;
let server: Server | undefined;

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), "volato-astro-build-"));
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
    join(cwd, "dist", "client", "_astro", "page.ABCD1234.js.map"),
    join(cwd, "dist", "server", "pages", "index.astro.mjs.map"),
    join(cwd, "dist", "server", "chunks", "Widget_vue_astro_type_script_index_0_lang.XYZ98765.mjs.map"),
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
            ? "../../../../src/client.ts"
            : index === 1
              ? "../../../src/pages/index.astro"
              : "../../../src/components/Widget.vue",
        ],
        sourcesContent: ["private source body"],
        names: [],
        mappings: "AAAA",
      }),
    );
  }
  return maps;
}

describe("Astro build composition", () => {
  it("preserves config and integration order while injecting one release", async () => {
    process.env.VITE_VOLATO_DSN = "https://public@api.volato.dev/project";
    process.env.VITE_VOLATO_ENVIRONMENT = "production";
    process.env.VOLATO_RELEASE = "astro-shared-release";
    const module = await import(
      `${pathToFileURL(join(assetsRoot, "build.mjs")).href}?${Date.now()}`
    );
    const first = { name: "first" };
    const second = { name: "second" };

    const config = module.withVolatoAstro({
      output: "server",
      integrations: [first, second],
      vite: {
        define: { __APP_FLAG__: "true" },
        build: { minify: false },
      },
    });

    expect(config.integrations.slice(0, 2)).toEqual([first, second]);
    expect(config.integrations.at(-1).name).toBe("volato-errors-private-astro");
    expect(config.vite.define.__APP_FLAG__).toBe("true");
    expect(config.vite.build).toMatchObject({
      minify: false,
      assetsInlineLimit: 0,
      sourcemap: "hidden",
    });
    expect(config.vite.define.__VOLATO_SERVER_RELEASE__).toBe('"astro-shared-release"');
    expect(JSON.parse(config.vite.define.__VOLATO_BROWSER_CONFIG__)).toEqual({
      dsn: "https://public@api.volato.dev/project",
      environment: "production",
      release: "astro-shared-release",
    });
    expect(JSON.stringify(config)).not.toContain("VOLATO_INGEST_TOKEN");

    const middleware: unknown[] = [];
    const scripts: Array<[string, string]> = [];
    config.integrations.at(-1).hooks["astro:config:setup"]({
      addMiddleware: (value: unknown) => middleware.push(value),
      injectScript: (stage: string, value: string) => scripts.push([stage, value]),
    });
    expect(middleware).toHaveLength(1);
    expect(middleware[0]).toMatchObject({ order: "pre" });
    expect(scripts).toEqual([
      ["before-hydration", 'import "/volato-astro/client.mjs";'],
      ["page", 'import "/volato-astro/client.mjs";'],
    ]);
  });
});

describe("Astro final client/server sourcemap uploader", () => {
  it("uploads privacy-cleaned maps under one release and removes every map", async () => {
    const paths = writeMaps();
    const receiver = await listen();

    await execFileAsync(process.execPath, [join(assetsRoot, "upload-sourcemaps.mjs")], {
      cwd,
      env: {
        ...process.env,
        VOLATO_DSN: `http://public@${receiver.origin.slice("http://".length)}/project`,
        VOLATO_INGEST_TOKEN: "private-upload-token",
        VOLATO_RELEASE: "astro-map-release",
      },
    });

    for (const path of paths) expect(() => readFileSync(path)).toThrow();
    expect(receiver.bodies).toHaveLength(3);
    expect(receiver.authorizations).toEqual([
      "Bearer private-upload-token",
      "Bearer private-upload-token",
      "Bearer private-upload-token",
    ]);
    const bodies = receiver.bodies.join("\n");
    expect(bodies).toContain("astro-map-release");
    expect(bodies).toContain("ABCD1234");
    expect(bodies).toContain("_astro/page.ABCD1234.js");
    expect(bodies).toContain("server/pages/index.astro.mjs");
    expect(bodies).toContain("server/chunks/Widget_vue_astro_type_script_index_0_lang.XYZ98765.mjs");
    expect(bodies).not.toContain("sourcesContent");
    expect(bodies).not.toContain("private source body");
  });

  it("fails loudly only after cleaning every map when an upload is rejected", async () => {
    const paths = writeMaps();
    const receiver = await listen(500);

    await expect(
      execFileAsync(process.execPath, [join(assetsRoot, "upload-sourcemaps.mjs")], {
        cwd,
        env: {
          ...process.env,
          VOLATO_DSN: `http://public@${receiver.origin.slice("http://".length)}/project`,
          VOLATO_INGEST_TOKEN: "private-upload-token",
          VOLATO_RELEASE: "astro-map-release",
        },
      }),
    ).rejects.toThrow(/Astro sourcemap upload failed with HTTP 500/i);
    for (const path of paths) expect(() => readFileSync(path)).toThrow();
  });

  it("removes every private map when credentials are intentionally absent", async () => {
    const paths = writeMaps();

    const result = await execFileAsync(
      process.execPath,
      [join(assetsRoot, "upload-sourcemaps.mjs")],
      { cwd, env: { ...process.env, VOLATO_DSN: "", VOLATO_INGEST_TOKEN: "", VOLATO_RELEASE: "" } },
    );

    for (const path of paths) expect(() => readFileSync(path)).toThrow();
    expect(result.stderr).toMatch(/removed but not uploaded/i);
  });
});
