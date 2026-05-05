import { mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runUpload } from "../cli/sourcemaps-upload";
import { __resetReleaseCacheForTests } from "../internal/release";

const ENDPOINT = "https://api.volato.dev";
const TOKEN = "deadbeefcafef00d";
const RELEASE = "abc12345abc12345";

const VALID_MAP = JSON.stringify({
  version: 3,
  sources: ["app/page.tsx"],
  sourcesContent: ["x"],
  names: [],
  mappings: "AAAA",
});

let testCwd: string;
let envBackup: NodeJS.ProcessEnv;

beforeEach(async () => {
  envBackup = { ...process.env };
  delete process.env.VOLATO_INGEST_TOKEN;
  delete process.env.VOLATO_INGEST_URL;
  delete process.env.VOLATO_RELEASE;
  delete process.env.NEXT_PUBLIC_VOLATO_RELEASE;
  __resetReleaseCacheForTests();

  testCwd = join(
    process.cwd(),
    `.tmp-upload-test-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`,
  );
  await mkdir(testCwd, { recursive: true });
});

afterEach(async () => {
  process.env = envBackup;
  __resetReleaseCacheForTests();
  await rm(testCwd, { recursive: true, force: true });
});

async function seedBuildOutput(maps: { path: string; content?: string }[]) {
  for (const m of maps) {
    const full = join(testCwd, ".next/static/chunks", m.path);
    await mkdir(join(full, ".."), { recursive: true });
    // Drop a sibling .js so projectFramePath has a target — but the
    // CLI doesn't actually read the .js, only the .map content.
    await writeFile(full.replace(/\.map$/, ""), "// minified");
    await writeFile(full, m.content ?? VALID_MAP);
  }
}

describe("runUpload — config", () => {
  it("throws a clear error when no token is set", async () => {
    await expect(
      runUpload({
        endpoint: ENDPOINT,
        release: RELEASE,
        cwd: testCwd,
        fetchImpl: vi.fn(),
        stdout: () => {},
        stderr: () => {},
      }),
    ).rejects.toThrow(/Missing ingest token/);
  });

  it("throws when no endpoint is set", async () => {
    await expect(
      runUpload({
        token: TOKEN,
        release: RELEASE,
        cwd: testCwd,
        fetchImpl: vi.fn(),
        stdout: () => {},
        stderr: () => {},
      }),
    ).rejects.toThrow(/Missing ingest endpoint/);
  });

  it("throws when no release is set or detectable", async () => {
    await expect(
      runUpload({
        token: TOKEN,
        endpoint: ENDPOINT,
        cwd: testCwd,
        fetchImpl: vi.fn(),
        stdout: () => {},
        stderr: () => {},
      }),
    ).rejects.toThrow(/Missing release/);
  });

  it("falls back to VOLATO_RELEASE for release detection", async () => {
    process.env.VOLATO_RELEASE = RELEASE;
    __resetReleaseCacheForTests();
    await seedBuildOutput([{ path: "page-abc12345.js.map" }]);
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({}), { status: 201 }));

    const summary = await runUpload({
      token: TOKEN,
      endpoint: ENDPOINT,
      cwd: testCwd,
      fetchImpl,
      stdout: () => {},
      stderr: () => {},
    });
    expect(summary.uploaded).toBe(1);
  });
});

describe("runUpload — walking and dispatch", () => {
  it("walks .next/static/chunks recursively and uploads each .js.map", async () => {
    await seedBuildOutput([
      { path: "page-abc12345.js.map" },
      { path: "app/dashboard-def67890.js.map" },
      { path: "main-app-1122334455667788.js.map" },
    ]);
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({}), { status: 201 }));

    const summary = await runUpload({
      token: TOKEN,
      endpoint: ENDPOINT,
      release: RELEASE,
      cwd: testCwd,
      fetchImpl,
      stdout: () => {},
      stderr: () => {},
    });

    expect(summary).toEqual({
      uploaded: 3,
      updated: 0,
      skipped: 0,
      failed: 0,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("skips a .map whose filename has no recognizable hex hash", async () => {
    await seedBuildOutput([
      { path: "page-abc12345.js.map" }, // ok
      { path: "no-hash.js.map" }, // no hex hash → skipped
    ]);
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({}), { status: 201 }));

    const lines: string[] = [];
    const summary = await runUpload({
      token: TOKEN,
      endpoint: ENDPOINT,
      release: RELEASE,
      cwd: testCwd,
      fetchImpl,
      stdout: () => {},
      stderr: (l) => lines.push(l),
    });

    expect(summary.uploaded).toBe(1);
    expect(summary.skipped).toBe(1);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(lines.join("")).toContain("Skipping");
    // The warning logs the .js path (after stripping the .map suffix),
    // since that's what the agent's stack frame would reference.
    expect(lines.join("")).toContain("no-hash.js");
  });

  it("counts 200 as updated and 201 as uploaded", async () => {
    await seedBuildOutput([
      { path: "page-aaaaaaaa.js.map" },
      { path: "page-bbbbbbbb.js.map" },
    ]);
    let call = 0;
    const fetchImpl = vi.fn().mockImplementation(() => {
      call += 1;
      return Promise.resolve(
        new Response(JSON.stringify({}), { status: call === 1 ? 201 : 200 }),
      );
    });

    const summary = await runUpload({
      token: TOKEN,
      endpoint: ENDPOINT,
      release: RELEASE,
      cwd: testCwd,
      fetchImpl,
      stdout: () => {},
      stderr: () => {},
    });

    expect(summary.uploaded).toBe(1);
    expect(summary.updated).toBe(1);
    expect(summary.failed).toBe(0);
  });

  it("counts non-2xx responses as failed and surfaces a warning", async () => {
    await seedBuildOutput([{ path: "page-abc12345.js.map" }]);
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ error: "rate_limited" }), {
          status: 429,
        }),
      );
    const lines: string[] = [];

    const summary = await runUpload({
      token: TOKEN,
      endpoint: ENDPOINT,
      release: RELEASE,
      cwd: testCwd,
      fetchImpl,
      stdout: () => {},
      stderr: (l) => lines.push(l),
    });

    expect(summary.failed).toBe(1);
    expect(summary.uploaded).toBe(0);
    expect(lines.join("")).toContain("Upload failed");
    expect(lines.join("")).toContain("429");
  });

  it("counts a thrown fetch as failed (network failure)", async () => {
    await seedBuildOutput([{ path: "page-abc12345.js.map" }]);
    const fetchImpl = vi
      .fn()
      .mockRejectedValue(new TypeError("network down"));
    const lines: string[] = [];

    const summary = await runUpload({
      token: TOKEN,
      endpoint: ENDPOINT,
      release: RELEASE,
      cwd: testCwd,
      fetchImpl,
      stdout: () => {},
      stderr: (l) => lines.push(l),
    });

    expect(summary.failed).toBe(1);
    expect(lines.join("")).toContain("Network failure");
  });
});

describe("runUpload — empty build", () => {
  it("returns a zero summary when the build has no chunks dir", async () => {
    const fetchImpl = vi.fn();
    const lines: string[] = [];
    const summary = await runUpload({
      token: TOKEN,
      endpoint: ENDPOINT,
      release: RELEASE,
      cwd: testCwd,
      fetchImpl,
      stdout: (l) => lines.push(l),
      stderr: () => {},
    });
    expect(summary).toEqual({
      uploaded: 0,
      updated: 0,
      skipped: 0,
      failed: 0,
    });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(lines.join("")).toContain("No client sourcemaps");
  });
});

describe("runUpload — wire-format invariant", () => {
  it("sends multipart fields with names matching the ingest contract", async () => {
    await seedBuildOutput([{ path: "page-abc12345.js.map" }]);
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({}), { status: 201 }));

    await runUpload({
      token: TOKEN,
      endpoint: ENDPOINT,
      release: RELEASE,
      cwd: testCwd,
      fetchImpl,
      stdout: () => {},
      stderr: () => {},
    });

    const init = fetchImpl.mock.calls[0]![1] as RequestInit;
    expect(
      (init.headers as Record<string, string>).Authorization,
    ).toBe(`Bearer ${TOKEN}`);
    const fd = init.body as FormData;
    expect(fd.get("release")).toBe(RELEASE);
    expect(fd.get("filename_hash")).toBe("abc12345");
    expect(typeof fd.get("display_path")).toBe("string");
    expect(fd.get("map")).toBeInstanceOf(Blob);
  });
});
