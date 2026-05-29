/**
 * Transport-resilience tests for the agent API client: bounded retry on
 * transient 5xx, no retry on 429 (Retry-After surfaced instead).
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getJson } from "../lib/api-client.js";

const credFile = join(tmpdir(), `volato-cli-test-cred-${process.pid}`);

beforeAll(async () => {
  await fs.writeFile(credFile, "test-token\n", { mode: 0o600 });
  process.env.VOLATO_CREDENTIALS_FILE = credFile;
  process.env.VOLATO_API_URL = "https://api.test.local";
});

afterAll(async () => {
  await fs.rm(credFile, { force: true });
  delete process.env.VOLATO_CREDENTIALS_FILE;
  delete process.env.VOLATO_API_URL;
});

afterEach(() => {
  vi.restoreAllMocks();
});

function jsonResponse(
  status: number,
  body: object,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

describe("api-client transport resilience", () => {
  it("retries a transient 503, then returns the success", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse(503, { error: "unavailable" }))
      .mockResolvedValueOnce(
        jsonResponse(200, { markdown: "ok", data: { n: 1 } }),
      );
    const resp = await getJson<{ n: number }>("/v1/errors");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(resp.ok).toBe(true);
    expect(resp.markdown).toBe("ok");
    expect(resp.data).toEqual({ n: 1 });
  });

  it("does NOT retry a 429 and surfaces Retry-After", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        jsonResponse(429, { error: "rate_limited" }, { "retry-after": "60" }),
      );
    const resp = await getJson("/v1/errors");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(resp.status).toBe(429);
    expect(resp.retryAfter).toBe(60);
  });

  it("attaches the bearer token and a timeout signal to the request", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(jsonResponse(200, { markdown: "ok" }));
    await getJson("/v1/errors");
    const [, init] = fetchMock.mock.calls[0]!;
    expect((init?.headers as Record<string, string>).Authorization).toBe(
      "Bearer test-token",
    );
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });
});
