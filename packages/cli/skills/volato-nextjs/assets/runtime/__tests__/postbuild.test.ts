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
const { runPostbuild } = require("../postbuild.cjs") as {
  runPostbuild(options: {
    cwd: string;
    env: Record<string, string>;
    fetchImpl: typeof fetch;
    warn: (message: string) => void;
  }): Promise<{ uploaded: number; failed: number }>;
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
});
