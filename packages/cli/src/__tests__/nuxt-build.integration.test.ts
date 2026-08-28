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
  "volato-nuxt",
  "assets",
  "runtime",
);

let cwd: string;
let server: Server | undefined;

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), "volato-nuxt-build-"));
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
  const browser = join(
    cwd,
    ".output",
    "public",
    "_nuxt",
    "DNdPygu-.js.map",
  );
  const serverMap = join(
    cwd,
    ".output",
    "server",
    "chunks",
    "routes",
    "ssr.mjs.map",
  );
  for (const path of [browser, serverMap]) {
    const isBrowser = path.includes(`${join(".output", "public")}/`);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(
      path,
      JSON.stringify({
        version: 3,
        file: isBrowser ? "DNdPygu-.js" : "ssr.mjs",
        sources: [isBrowser ? "app/pages/index.vue" : "server/api/boom.ts"],
        sourcesContent: ["private source body"],
        names: [],
        mappings: "AAAA",
      }),
    );
  }
  return [browser, serverMap];
}

describe("Nuxt build composition", () => {
  it("preserves application config and injects one release without a browser token", async () => {
    process.env.VITE_VOLATO_DSN = "https://public@api.volato.dev/project";
    process.env.VITE_VOLATO_ENVIRONMENT = "production";
    process.env.VOLATO_RELEASE = "nuxt-shared-release";
    const module = await import(
      `${pathToFileURL(join(assetsRoot, "build.mjs")).href}?${Date.now()}`
    );
    const existingClose = () => undefined;
    const config = {
      modules: ["application-module"],
      vite: { define: { __APP_FLAG__: "true" }, build: { minify: false } },
      nitro: {
        preset: "node-server",
        hooks: { close: existingClose },
        replace: { __APP_SERVER_FLAG__: "true" },
      },
    };

    const result = module.withVolatoNuxt(config);

    expect(result.modules).toEqual(["application-module"]);
    expect(result.vite.define.__APP_FLAG__).toBe("true");
    expect(result.vite.build).toMatchObject({ minify: false, sourcemap: "hidden" });
    expect(result.sourcemap).toEqual({ client: "hidden", server: true });
    expect(result.nitro.hooks.close).toBe(existingClose);
    expect(result.nitro).toMatchObject({ preset: "node-server", sourceMap: true });
    expect(result.nitro.replace.__APP_SERVER_FLAG__).toBe("true");
    expect(result.nitro.replace.__VOLATO_SERVER_RELEASE__).toBe(
      '"nuxt-shared-release"',
    );
    const browserConfig = String(result.vite.define.__VOLATO_BROWSER_CONFIG__);
    expect(JSON.parse(browserConfig)).toEqual({
      dsn: "https://public@api.volato.dev/project",
      environment: "production",
      release: "nuxt-shared-release",
    });
    expect(browserConfig).not.toContain("VOLATO_INGEST_TOKEN");
  });
});

describe("Nuxt client/server sourcemap uploader", () => {
  it("uploads privacy-cleaned maps under one release and removes every map", async () => {
    const paths = writeMaps();
    const receiver = await listen();

    await execFileAsync(
      process.execPath,
      [join(assetsRoot, "upload-sourcemaps.mjs"), join(cwd, ".output")],
      {
        cwd,
        env: {
          ...process.env,
          VOLATO_DSN: `http://public@${receiver.origin.slice("http://".length)}/project`,
          VOLATO_INGEST_TOKEN: "private-upload-token",
          VOLATO_RELEASE: "nuxt-map-release",
        },
      },
    );

    for (const path of paths) expect(() => readFileSync(path)).toThrow();
    expect(receiver.bodies).toHaveLength(2);
    expect(receiver.authorizations).toEqual([
      "Bearer private-upload-token",
      "Bearer private-upload-token",
    ]);
    const body = receiver.bodies.join("\n");
    expect(body).toContain("nuxt-map-release");
    expect(body).toContain("DNdPygu-");
    expect(body).toContain("_nuxt/DNdPygu-.js");
    expect(body).toContain("server/chunks/routes/ssr.mjs");
    expect(body).toContain("app/pages/index.vue");
    expect(body).toContain("server/api/boom.ts");
    expect(body).not.toContain("sourcesContent");
    expect(body).not.toContain("private source body");
  });

  it("fails loudly after removing all maps when upload is rejected", async () => {
    const paths = writeMaps();
    const receiver = await listen(500);

    await expect(
      execFileAsync(
        process.execPath,
        [join(assetsRoot, "upload-sourcemaps.mjs"), join(cwd, ".output")],
        {
          cwd,
          env: {
            ...process.env,
            VOLATO_DSN: `http://public@${receiver.origin.slice("http://".length)}/project`,
            VOLATO_INGEST_TOKEN: "private-upload-token",
            VOLATO_RELEASE: "nuxt-map-release",
          },
        },
      ),
    ).rejects.toThrow(/sourcemap upload failed with HTTP 500/i);
    for (const path of paths) expect(() => readFileSync(path)).toThrow();
  });
});
