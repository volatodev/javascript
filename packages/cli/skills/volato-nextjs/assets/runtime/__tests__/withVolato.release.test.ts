/**
 * Tests for `withVolato()`'s release auto-detection — the missing link
 * that lights up the agent's commit-transition feature for users who
 * never bothered to map their provider's SHA env var.
 *
 * Three layers:
 *   - `__detectGitShaForTests` against real temp git repos.
 *   - `__buildEnvWithIdentityForTests` for the env-merge logic (pure).
 *   - End-to-end through `withVolato()` to pin the glue.
 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  __buildEnvWithIdentityForTests,
  __detectGitShaForTests,
  __VolatoSourceMapsPlugin,
  withVolato,
} from "../withVolato";

// Suppress the load-time VOLATO_INGEST_TOKEN warning for the whole
// file — that's covered by `withVolato.test.ts`. We just want the
// release path here.
beforeAll(() => {
  process.env.VOLATO_INGEST_TOKEN = "suite-token";
});

function makeEmptyDir(): string {
  return mkdtempSync(join(tmpdir(), "volato-nogit-"));
}

describe("__detectGitShaForTests", () => {
  it("returns the 40-char hex SHA of HEAD inside a real git repo", () => {
    // The package is tested from the checked-out repository. Reuse that real
    // repository instead of initialising a nested `.git` directory: several
    // hardened CI/sandbox environments deliberately forbid creating nested
    // Git metadata even though read-only `git rev-parse` is allowed.
    const sha = __detectGitShaForTests(process.cwd());
    expect(sha).toMatch(/^[a-f0-9]{40}$/);
  });

  it("returns undefined when the directory has no .git", () => {
    const dir = makeEmptyDir();
    expect(__detectGitShaForTests(dir)).toBeUndefined();
  });

  it("returns undefined when the path doesn't exist", () => {
    expect(
      __detectGitShaForTests("/nonexistent/path/that/cannot/be"),
    ).toBeUndefined();
  });
});

describe("__buildEnvWithIdentityForTests — pure env merge", () => {
  it("injects separate release and commit identities", () => {
    const out = __buildEnvWithIdentityForTests({}, "release-1", "abc123");
    expect(out).toEqual({
      VOLATO_RELEASE: "release-1",
      NEXT_PUBLIC_VOLATO_RELEASE: "release-1",
      VOLATO_COMMIT_SHA: "abc123",
      NEXT_PUBLIC_VOLATO_COMMIT_SHA: "abc123",
    });
  });

  it("preserves user entries unrelated to release", () => {
    const out = __buildEnvWithIdentityForTests(
      { MY_API_KEY: "secret", FEATURE_X: "on" },
      "release-1",
      "abc123",
    );
    expect(out).toEqual({
      MY_API_KEY: "secret",
      FEATURE_X: "on",
      VOLATO_RELEASE: "release-1",
      NEXT_PUBLIC_VOLATO_RELEASE: "release-1",
      VOLATO_COMMIT_SHA: "abc123",
      NEXT_PUBLIC_VOLATO_COMMIT_SHA: "abc123",
    });
  });

  it("respects a user-provided VOLATO_RELEASE in nextConfig.env (no overwrite)", () => {
    const out = __buildEnvWithIdentityForTests(
      { VOLATO_RELEASE: "user-set-v1.2.3" },
      "release-1",
      "abc1234",
    );
    expect(out.VOLATO_RELEASE).toBe("user-set-v1.2.3");
    // The PUBLIC mirror still gets injected because the user only
    // wired the server side — we extend, never replace.
    expect(out.NEXT_PUBLIC_VOLATO_RELEASE).toBe("release-1");
    expect(out.VOLATO_COMMIT_SHA).toBe("abc1234");
  });

  it("respects a user-provided NEXT_PUBLIC_VOLATO_RELEASE", () => {
    const out = __buildEnvWithIdentityForTests(
      { NEXT_PUBLIC_VOLATO_RELEASE: "user-public" },
      "release-1",
      "abc1234",
    );
    expect(out.VOLATO_RELEASE).toBe("release-1");
    expect(out.NEXT_PUBLIC_VOLATO_RELEASE).toBe("user-public");
  });

  it("leaves user env untouched when no identity is available", () => {
    const out = __buildEnvWithIdentityForTests(
      { MY_API_KEY: "secret" },
      undefined,
      undefined,
    );
    expect(out).toEqual({ MY_API_KEY: "secret" });
    expect(out).not.toHaveProperty("VOLATO_RELEASE");
    expect(out).not.toHaveProperty("NEXT_PUBLIC_VOLATO_RELEASE");
    expect(out).not.toHaveProperty("VOLATO_COMMIT_SHA");
  });

  it("returns an empty object when no identity + no existing env", () => {
    expect(
      __buildEnvWithIdentityForTests(undefined, undefined, undefined),
    ).toEqual({});
    expect(
      __buildEnvWithIdentityForTests(null, undefined, undefined),
    ).toEqual({});
  });

  it("tolerates non-object existing env without throwing", () => {
    // Defensive: nextConfig.env is `unknown`, a typed-poorly user might
    // pass an array or a primitive. We should not crash.
    expect(__buildEnvWithIdentityForTests([], "release-1", "abc123")).toEqual({
      VOLATO_RELEASE: "release-1",
      NEXT_PUBLIC_VOLATO_RELEASE: "release-1",
      VOLATO_COMMIT_SHA: "abc123",
      NEXT_PUBLIC_VOLATO_COMMIT_SHA: "abc123",
    });
    expect(
      __buildEnvWithIdentityForTests("garbage", "release-1", "abc123"),
    ).toEqual({
      VOLATO_RELEASE: "release-1",
      NEXT_PUBLIC_VOLATO_RELEASE: "release-1",
      VOLATO_COMMIT_SHA: "abc123",
      NEXT_PUBLIC_VOLATO_COMMIT_SHA: "abc123",
    });
  });
});

describe("withVolato — end-to-end release injection", () => {
  const ORIGINAL_RELEASE = process.env.VOLATO_RELEASE;
  const ORIGINAL_COMMIT_SHA = process.env.VOLATO_COMMIT_SHA;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    warnSpy.mockRestore();
    if (ORIGINAL_RELEASE === undefined) {
      delete process.env.VOLATO_RELEASE;
    } else {
      process.env.VOLATO_RELEASE = ORIGINAL_RELEASE;
    }
    if (ORIGINAL_COMMIT_SHA === undefined) {
      delete process.env.VOLATO_COMMIT_SHA;
    } else {
      process.env.VOLATO_COMMIT_SHA = ORIGINAL_COMMIT_SHA;
    }
  });

  it("returns a config with env.VOLATO_RELEASE populated when run inside a git repo", () => {
    // This test file lives inside the volato-dev javascript repo,
    // which is a real git repo. detectGitSha (without cwd override)
    // runs in process.cwd() — the package root during `vitest run`.
    // We don't pin the exact SHA; we assert the shape.
    delete process.env.VOLATO_RELEASE;
    const out = withVolato({ reactStrictMode: true });
    const env = (out as { env?: Record<string, string> }).env;
    expect(env).toBeDefined();
    expect(env?.VOLATO_RELEASE).toMatch(/^[a-f0-9]{40}$/);
    expect(env?.NEXT_PUBLIC_VOLATO_RELEASE).toBe(env?.VOLATO_RELEASE);
    expect(env?.VOLATO_COMMIT_SHA).toBe(env?.VOLATO_RELEASE);
    expect(env?.NEXT_PUBLIC_VOLATO_COMMIT_SHA).toBe(env?.VOLATO_COMMIT_SHA);
  });

  it("passes the same auto-detected build SHA to the sourcemap uploader", () => {
    delete process.env.VOLATO_RELEASE;
    const out = withVolato({});
    const env = (out as { env?: Record<string, string> }).env;
    const webpack = (
      out as {
        webpack?: (
          config: { plugins?: unknown[] },
          ctx: { isServer: boolean },
        ) => { plugins?: unknown[] };
      }
    ).webpack;

    expect(webpack).toBeDefined();
    const compiled = webpack!({ plugins: [] }, { isServer: false });
    const plugin = compiled.plugins?.find(
      (candidate) => candidate instanceof __VolatoSourceMapsPlugin,
    );

    expect(plugin).toBeDefined();
    expect(
      (
        plugin as unknown as {
          opts: { release?: string };
        }
      ).opts.release,
    ).toBe(env?.VOLATO_RELEASE);
  });

  it("honours an explicit VOLATO_RELEASE in process.env over git", () => {
    process.env.VOLATO_RELEASE = "explicit-v9.9.9";
    const out = withVolato({});
    const env = (out as { env?: Record<string, string> }).env;
    expect(env?.VOLATO_RELEASE).toBe("explicit-v9.9.9");
    expect(env?.NEXT_PUBLIC_VOLATO_RELEASE).toBe("explicit-v9.9.9");
    expect(env?.VOLATO_COMMIT_SHA).toMatch(/^[a-f0-9]{40}$/);
  });

  it("honours options.release over both process.env and git", () => {
    process.env.VOLATO_RELEASE = "from-env";
    const out = withVolato({}, { release: "from-options" });
    const env = (out as { env?: Record<string, string> }).env;
    expect(env?.VOLATO_RELEASE).toBe("from-options");
    expect(env?.VOLATO_COMMIT_SHA).toMatch(/^[a-f0-9]{40}$/);
  });

  it("honours an explicit validated commit SHA independently", () => {
    process.env.VOLATO_RELEASE = "release-1";
    process.env.VOLATO_COMMIT_SHA = "0123456789abcdef";
    const out = withVolato({});
    const env = (out as { env?: Record<string, string> }).env;
    expect(env?.VOLATO_RELEASE).toBe("release-1");
    expect(env?.VOLATO_COMMIT_SHA).toBe("0123456789abcdef");
  });

  it("preserves user nextConfig.env entries when injecting release", () => {
    process.env.VOLATO_RELEASE = "abc123";
    const out = withVolato({
      env: { MY_API_KEY: "secret", FEATURE_X: "on" },
    });
    const env = (out as { env?: Record<string, string> }).env;
    expect(env?.MY_API_KEY).toBe("secret");
    expect(env?.FEATURE_X).toBe("on");
    expect(env?.VOLATO_RELEASE).toBe("abc123");
  });

  it("respects a user-wired VOLATO_RELEASE in nextConfig.env", () => {
    process.env.VOLATO_RELEASE = "from-env";
    const out = withVolato({ env: { VOLATO_RELEASE: "user-config-v1" } });
    const env = (out as { env?: Record<string, string> }).env;
    expect(env?.VOLATO_RELEASE).toBe("user-config-v1");
  });

  it("still injects env when disableUpload is set (capture still wants the release tag)", () => {
    process.env.VOLATO_RELEASE = "abc123";
    const out = withVolato({}, { disableUpload: true });
    const env = (out as { env?: Record<string, string> }).env;
    expect(env?.VOLATO_RELEASE).toBe("abc123");
    expect(env?.NEXT_PUBLIC_VOLATO_RELEASE).toBe("abc123");
    // disableUpload still kills the webpack hook.
    expect((out as { webpack?: unknown }).webpack).toBeUndefined();
  });
});
