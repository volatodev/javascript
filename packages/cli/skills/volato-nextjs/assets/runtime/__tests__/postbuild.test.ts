import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const { runPostbuild, runPostbuildCli } = require("../postbuild.cjs") as {
  runPostbuild(options: {
    cwd: string;
    env: Record<string, string>;
    fetchImpl: typeof fetch;
    warn: (message: string) => void;
  }): Promise<{ uploaded: number; failed: number }>;
  runPostbuildCli(options: {
    cwd: string;
    env: Record<string, string>;
    fetchImpl: typeof fetch;
    warn: (message: string) => void;
  }): Promise<number>;
};

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("Next.js 16 postbuild sourcemaps", () => {
  it("uploads a final Turbopack browser map without sourcesContent, then removes it", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "volato-next-postbuild-"));
    roots.push(cwd);
    const chunks = join(cwd, ".next", "static", "chunks");
    mkdirSync(chunks, { recursive: true });
    const mapPath = join(chunks, "0cz1d0mv5g_q7.js.map");
    writeFileSync(
      mapPath,
      JSON.stringify({
        version: 3,
        file: "0cz1d0mv5g_q7.js",
        sources: ["app/page.tsx"],
        sourcesContent: ["throw new Error('private source')"],
        names: [],
        mappings: "AAAA",
      }),
    );
    const fetchImpl = vi.fn(async () => new Response(null, { status: 201 }));

    const result = await runPostbuild({
      cwd,
      env: {
        NEXT_PUBLIC_VOLATO_DSN:
          "https://public@api.volato.dev/11111111-1111-4111-8111-111111111111",
        VOLATO_INGEST_TOKEN: "server-token",
        VOLATO_RELEASE: "release-1",
      },
      fetchImpl: fetchImpl as unknown as typeof fetch,
      warn: vi.fn(),
    });

    expect(result).toEqual({ uploaded: 1, failed: 0 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [, init] = fetchImpl.mock.calls[0]!;
    const form = init?.body as FormData;
    expect(form.get("filename_hash")).toBe("0cz1d0mv5g_q7");
    const uploaded = JSON.parse(await (form.get("map") as Blob).text()) as {
      sourcesContent?: string[];
    };
    expect(uploaded.sourcesContent).toBeUndefined();
    expect(existsSync(mapPath)).toBe(false);
  });

  it("skips a structurally empty Turbopack map without sending it", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "volato-next-postbuild-"));
    roots.push(cwd);
    const chunks = join(cwd, ".next", "static", "chunks");
    mkdirSync(chunks, { recursive: true });
    const mapPath = join(chunks, "0cz1d0mv5g_q7.js.map");
    writeFileSync(
      mapPath,
      JSON.stringify({
        version: 3,
        file: "0cz1d0mv5g_q7.js",
        sources: [],
        names: [],
        mappings: "",
      }),
    );
    const fetchImpl = vi.fn(async () =>
      new Response("unprocessable", { status: 422 }),
    );
    const warn = vi.fn();

    const result = await runPostbuild({
      cwd,
      env: {
        NEXT_PUBLIC_VOLATO_DSN:
          "https://public@api.volato.dev/11111111-1111-4111-8111-111111111111",
        VOLATO_INGEST_TOKEN: "server-token",
        VOLATO_RELEASE: "release-1",
      },
      fetchImpl: fetchImpl as unknown as typeof fetch,
      warn,
    });

    expect(result).toEqual({ uploaded: 0, failed: 0 });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      expect.stringMatching(/empty sourcemap/i),
    );
  });

  it("skips an indexed Turbopack runtime map without sending it", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "volato-next-postbuild-"));
    roots.push(cwd);
    const chunks = join(cwd, ".next", "static", "chunks");
    mkdirSync(chunks, { recursive: true });
    const mapPath = join(chunks, "0cz1d0mv5g_q7.js.map");
    writeFileSync(
      mapPath,
      JSON.stringify({
        version: 3,
        sections: [
          {
            offset: { line: 0, column: 0 },
            map: {
              version: 3,
              sources: ["turbopack/runtime.ts"],
              names: [],
              mappings: "AAAA",
            },
          },
        ],
      }),
    );
    const fetchImpl = vi.fn();
    const warn = vi.fn();

    const result = await runPostbuild({
      cwd,
      env: {
        NEXT_PUBLIC_VOLATO_DSN:
          "https://public@api.volato.dev/11111111-1111-4111-8111-111111111111",
        VOLATO_INGEST_TOKEN: "server-token",
        VOLATO_RELEASE: "release-1",
      },
      fetchImpl: fetchImpl as unknown as typeof fetch,
      warn,
    });

    expect(result).toEqual({ uploaded: 0, failed: 0 });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      expect.stringMatching(/indexed sourcemaps.*not resolvable/i),
    );
  });

  it("returns a non-zero CLI exit when final browser maps cannot be uploaded", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "volato-next-postbuild-"));
    roots.push(cwd);
    const chunks = join(cwd, ".next", "static", "chunks");
    mkdirSync(chunks, { recursive: true });
    writeFileSync(
      join(chunks, "0cz1d0mv5g_q7.js.map"),
      JSON.stringify({
        version: 3,
        sources: ["app/page.tsx"],
        names: [],
        mappings: "AAAA",
      }),
    );

    const warn = vi.fn();
    const exitCode = await runPostbuildCli({
      cwd,
      env: {
        NEXT_PUBLIC_VOLATO_DSN: "",
        VOLATO_INGEST_TOKEN: "",
        VOLATO_RELEASE: "release-1",
      },
      fetchImpl: vi.fn() as unknown as typeof fetch,
      warn,
    });

    expect(exitCode).toBe(1);
    expect(warn.mock.calls.flat().join(" ")).toMatch(/both required/i);
  });
});
