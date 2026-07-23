import { describe, expect, it } from "vitest";
import {
  dsnToIngestUrl,
  parseDSN,
  projectFramePath,
} from "../protocol";

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
    ).toEqual(
      projectFramePath(".next/static/chunks/page-abc12345.js"),
    );
  });
});
