import { describe, expect, it } from "vitest";
import { dsnToIngestUrl, parseDSN, projectFramePath } from "../protocol";

describe("generated protocol helpers", () => {
  it("parses a DSN without exposing userinfo in the ingest URL", () => {
    const dsn = "https://pk_test@api.volato.dev/project-id";
    expect(parseDSN(dsn)).toEqual({
      origin: "https://api.volato.dev",
      publicKey: "pk_test",
      projectId: "project-id",
    });
    expect(dsnToIngestUrl(dsn)).toBe("https://api.volato.dev/api/ingest");
  });

  it("rejects malformed or over-privileged DSNs", () => {
    expect(() => parseDSN("not-a-url")).toThrow();
    expect(() =>
      parseDSN("https://pk:password@api.volato.dev/project-id"),
    ).toThrow();
    expect(() => parseDSN("https://pk@api.volato.dev/a/b")).toThrow();
  });

  it("projects runtime and build paths onto the same sourcemap key", () => {
    expect(
      projectFramePath(
        "https://app.example.com/_next/static/chunks/page-abc12345.js",
      ),
    ).toEqual(projectFramePath(".next/static/chunks/page-abc12345.js"));
  });

  it("projects a Next.js 16 Turbopack browser chunk onto its uploaded map", () => {
    const runtime = projectFramePath(
      "https://app.example.com/_next/static/chunks/0cz1d0mv5g_q7.js",
    );
    const build = projectFramePath(".next/static/chunks/0cz1d0mv5g_q7.js.map");

    expect(runtime).toEqual(build);
    expect(runtime).toMatchObject({
      display_path: "static/chunks/0cz1d0mv5g_q7.js",
      filename_hash: "0cz1d0mv5g_q7",
    });
  });

  it("projects Next.js server runtime and build paths onto the same key", () => {
    const runtime = projectFramePath(
      "/var/task/.next/server/app/api/crash/route.js",
    );
    const build = projectFramePath(".next/server/app/api/crash/route.js.map");

    expect(runtime).toEqual(build);
    expect(runtime).toMatchObject({
      display_path: "server/app/api/crash/route.js",
      filename_hash: "p322b04c226bf424",
    });
  });
});
