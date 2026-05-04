import { describe, expect, it } from "vitest";
import {
  InvalidDSNError,
  dsnProjectId,
  dsnPublicKey,
  dsnToIngestUrl,
  parseDSN,
} from "../dsn";

const PROJECT_ID = "11111111-2222-3333-4444-555555555555";
const DSN = `https://pk_test_abc@ingest.volato.dev/${PROJECT_ID}`;

describe("parseDSN", () => {
  it("extracts origin, publicKey, and projectId from a Sentry-style DSN", () => {
    expect(parseDSN(DSN)).toEqual({
      origin: "https://ingest.volato.dev",
      publicKey: "pk_test_abc",
      projectId: PROJECT_ID,
    });
  });

  it("supports custom ports in the host", () => {
    expect(parseDSN(`https://pk_x@localhost:4000/${PROJECT_ID}`)).toEqual({
      origin: "https://localhost:4000",
      publicKey: "pk_x",
      projectId: PROJECT_ID,
    });
  });

  it("supports http for local development", () => {
    expect(parseDSN(`http://pk_y@127.0.0.1:8080/${PROJECT_ID}`).origin).toBe(
      "http://127.0.0.1:8080",
    );
  });

  it("rejects DSN with no userinfo (missing public key)", () => {
    expect(() => parseDSN(`https://ingest.volato.dev/${PROJECT_ID}`)).toThrow(
      InvalidDSNError,
    );
  });

  it("rejects DSN with a password segment", () => {
    expect(() =>
      parseDSN(`https://pk:secret@ingest.volato.dev/${PROJECT_ID}`),
    ).toThrow(/password segment is not allowed/);
  });

  it("rejects DSN missing projectId", () => {
    expect(() => parseDSN("https://pk_test@ingest.volato.dev/")).toThrow(
      /missing projectId/,
    );
  });

  it("rejects DSN with multi-segment path", () => {
    expect(() =>
      parseDSN("https://pk_test@ingest.volato.dev/a/b"),
    ).toThrow(/single path segment/);
  });

  it("rejects unsupported protocols", () => {
    expect(() => parseDSN(`ws://pk@host/${PROJECT_ID}`)).toThrow(
      /protocol must be http or https/,
    );
  });

  it("rejects malformed URLs", () => {
    expect(() => parseDSN("not-a-url")).toThrow(/not a valid URL/);
  });
});

describe("dsnToIngestUrl", () => {
  it("strips userinfo and path, points to /api/ingest on the same origin", () => {
    expect(dsnToIngestUrl(DSN)).toBe("https://ingest.volato.dev/api/ingest");
  });
});

describe("helpers", () => {
  it("dsnPublicKey returns the key, null on invalid DSN", () => {
    expect(dsnPublicKey(DSN)).toBe("pk_test_abc");
    expect(dsnPublicKey("garbage")).toBeNull();
  });

  it("dsnProjectId returns the project id, null on invalid DSN", () => {
    expect(dsnProjectId(DSN)).toBe(PROJECT_ID);
    expect(dsnProjectId("garbage")).toBeNull();
  });
});
