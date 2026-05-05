import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runPurge } from "../cli/sourcemaps";

const ENDPOINT = "https://api.volato.dev";
const TOKEN = "deadbeefcafef00d";

describe("runPurge — auth and config", () => {
  let envBackup: NodeJS.ProcessEnv;

  beforeEach(() => {
    envBackup = { ...process.env };
    delete process.env.VOLATO_INGEST_TOKEN;
    delete process.env.VOLATO_INGEST_URL;
  });

  afterEach(() => {
    process.env = envBackup;
  });

  it("throws a clear error when no token is available", async () => {
    await expect(
      runPurge({ endpoint: ENDPOINT, fetchImpl: vi.fn() }),
    ).rejects.toThrow(/Missing ingest token/);
  });

  it("throws a clear error when no endpoint is available", async () => {
    await expect(
      runPurge({ token: TOKEN, fetchImpl: vi.fn() }),
    ).rejects.toThrow(/Missing ingest endpoint/);
  });

  it("falls back to VOLATO_INGEST_TOKEN env", async () => {
    process.env.VOLATO_INGEST_TOKEN = TOKEN;
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ purged: 0, scope: "project" }), {
          status: 200,
        }),
      );
    await runPurge({
      endpoint: ENDPOINT,
      fetchImpl,
      stdout: () => {},
    });
    const headers = (fetchImpl.mock.calls[0]![1] as RequestInit)
      .headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${TOKEN}`);
  });

  it("falls back to VOLATO_INGEST_URL env", async () => {
    process.env.VOLATO_INGEST_URL = ENDPOINT;
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ purged: 0, scope: "project" }), {
          status: 200,
        }),
      );
    await runPurge({
      token: TOKEN,
      fetchImpl,
      stdout: () => {},
    });
    const url = (fetchImpl.mock.calls[0]![0] as URL).toString();
    expect(url).toBe(`${ENDPOINT}/api/sourcemaps`);
  });
});

describe("runPurge — request shape", () => {
  it("sends DELETE with bearer auth and no body when --release is absent", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ purged: 5, scope: "project" }), {
          status: 200,
        }),
      );
    const lines: string[] = [];

    const result = await runPurge({
      token: TOKEN,
      endpoint: ENDPOINT,
      fetchImpl,
      stdout: (l) => lines.push(l),
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const init = fetchImpl.mock.calls[0]![1] as RequestInit;
    expect(init.method).toBe("DELETE");
    expect(init.body).toBeUndefined();
    expect(
      (init.headers as Record<string, string>).Authorization,
    ).toBe(`Bearer ${TOKEN}`);
    // No content-type when no body.
    expect(
      (init.headers as Record<string, string>)["Content-Type"],
    ).toBeUndefined();

    expect(result.purged).toBe(5);
    expect(lines.join("")).toContain("Purged 5 map(s) from project");
  });

  it("includes a JSON body and content-type when --release is set", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ purged: 2, scope: "rel-x" }), {
          status: 200,
        }),
      );
    await runPurge({
      token: TOKEN,
      endpoint: ENDPOINT,
      release: "rel-x",
      fetchImpl,
      stdout: () => {},
    });

    const init = fetchImpl.mock.calls[0]![1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(init.body as string)).toEqual({ release: "rel-x" });
  });
});

describe("runPurge — error surfacing", () => {
  it("throws when the server returns non-2xx", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ error: "invalid_token" }), {
          status: 401,
        }),
      );
    await expect(
      runPurge({
        token: TOKEN,
        endpoint: ENDPOINT,
        fetchImpl,
        stdout: () => {},
      }),
    ).rejects.toThrow(/Purge failed: 401/);
  });
});
