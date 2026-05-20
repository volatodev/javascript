/**
 * Tests for `withVolato()`'s release auto-detection — the missing link
 * that lights up the agent's commit-transition feature for users who
 * never bothered to map their provider's SHA env var.
 *
 * Three layers:
 *   - `__detectGitShaForTests` against real temp git repos.
 *   - `__buildEnvWithReleaseForTests` for the env-merge logic (pure).
 *   - End-to-end through `withVolato()` to pin the glue.
 */

import { execSync } from "node:child_process";
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
  __buildEnvWithReleaseForTests,
  __detectGitShaForTests,
  withVolato,
} from "../withVolato";

// Suppress the load-time VOLATO_INGEST_TOKEN warning for the whole
// file — that's covered by `withVolato.test.ts`. We just want the
// release path here.
beforeAll(() => {
  process.env.VOLATO_INGEST_TOKEN = "suite-token";
});

function makeGitRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "volato-git-"));
  // Set author/committer via env so the test doesn't depend on the
  // runner's global git config (CI machines often have none).
  const env = {
    ...process.env,
    GIT_AUTHOR_NAME: "t",
    GIT_AUTHOR_EMAIL: "t@t",
    GIT_COMMITTER_NAME: "t",
    GIT_COMMITTER_EMAIL: "t@t",
  };
  execSync("git init -q -b main", { cwd: dir, env });
  execSync("git commit --allow-empty -q -m init", { cwd: dir, env });
  return dir;
}

function makeEmptyDir(): string {
  return mkdtempSync(join(tmpdir(), "volato-nogit-"));
}

describe("__detectGitShaForTests", () => {
  it("returns the 40-char hex SHA of HEAD inside a real git repo", () => {
    const repo = makeGitRepo();
    const sha = __detectGitShaForTests(repo);
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

describe("__buildEnvWithReleaseForTests — pure env merge", () => {
  it("injects both VOLATO_RELEASE and NEXT_PUBLIC_VOLATO_RELEASE", () => {
    const out = __buildEnvWithReleaseForTests({}, "abc123");
    expect(out).toEqual({
      VOLATO_RELEASE: "abc123",
      NEXT_PUBLIC_VOLATO_RELEASE: "abc123",
    });
  });

  it("preserves user entries unrelated to release", () => {
    const out = __buildEnvWithReleaseForTests(
      { MY_API_KEY: "secret", FEATURE_X: "on" },
      "abc123",
    );
    expect(out).toEqual({
      MY_API_KEY: "secret",
      FEATURE_X: "on",
      VOLATO_RELEASE: "abc123",
      NEXT_PUBLIC_VOLATO_RELEASE: "abc123",
    });
  });

  it("respects a user-provided VOLATO_RELEASE in nextConfig.env (no overwrite)", () => {
    const out = __buildEnvWithReleaseForTests(
      { VOLATO_RELEASE: "user-set-v1.2.3" },
      "git-detected-sha",
    );
    expect(out.VOLATO_RELEASE).toBe("user-set-v1.2.3");
    // The PUBLIC mirror still gets injected because the user only
    // wired the server side — we extend, never replace.
    expect(out.NEXT_PUBLIC_VOLATO_RELEASE).toBe("git-detected-sha");
  });

  it("respects a user-provided NEXT_PUBLIC_VOLATO_RELEASE", () => {
    const out = __buildEnvWithReleaseForTests(
      { NEXT_PUBLIC_VOLATO_RELEASE: "user-public" },
      "git-detected-sha",
    );
    expect(out.VOLATO_RELEASE).toBe("git-detected-sha");
    expect(out.NEXT_PUBLIC_VOLATO_RELEASE).toBe("user-public");
  });

  it("leaves user env untouched when no SHA is available", () => {
    const out = __buildEnvWithReleaseForTests(
      { MY_API_KEY: "secret" },
      undefined,
    );
    expect(out).toEqual({ MY_API_KEY: "secret" });
    expect(out).not.toHaveProperty("VOLATO_RELEASE");
    expect(out).not.toHaveProperty("NEXT_PUBLIC_VOLATO_RELEASE");
  });

  it("returns an empty object when no SHA + no existing env", () => {
    expect(__buildEnvWithReleaseForTests(undefined, undefined)).toEqual({});
    expect(__buildEnvWithReleaseForTests(null, undefined)).toEqual({});
  });

  it("tolerates non-object existing env without throwing", () => {
    // Defensive: nextConfig.env is `unknown`, a typed-poorly user might
    // pass an array or a primitive. We should not crash.
    expect(__buildEnvWithReleaseForTests([], "abc123")).toEqual({
      VOLATO_RELEASE: "abc123",
      NEXT_PUBLIC_VOLATO_RELEASE: "abc123",
    });
    expect(__buildEnvWithReleaseForTests("garbage", "abc123")).toEqual({
      VOLATO_RELEASE: "abc123",
      NEXT_PUBLIC_VOLATO_RELEASE: "abc123",
    });
  });
});

describe("withVolato — end-to-end release injection", () => {
  const ORIGINAL_RELEASE = process.env.VOLATO_RELEASE;
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
  });

  it("honours an explicit VOLATO_RELEASE in process.env over git", () => {
    process.env.VOLATO_RELEASE = "explicit-v9.9.9";
    const out = withVolato({});
    const env = (out as { env?: Record<string, string> }).env;
    expect(env?.VOLATO_RELEASE).toBe("explicit-v9.9.9");
    expect(env?.NEXT_PUBLIC_VOLATO_RELEASE).toBe("explicit-v9.9.9");
  });

  it("honours options.release over both process.env and git", () => {
    process.env.VOLATO_RELEASE = "from-env";
    const out = withVolato({}, { release: "from-options" });
    const env = (out as { env?: Record<string, string> }).env;
    expect(env?.VOLATO_RELEASE).toBe("from-options");
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

  it("still injects env when disableUpload is set (the SDK still wants the release tag)", () => {
    process.env.VOLATO_RELEASE = "abc123";
    const out = withVolato({}, { disableUpload: true });
    const env = (out as { env?: Record<string, string> }).env;
    expect(env?.VOLATO_RELEASE).toBe("abc123");
    expect(env?.NEXT_PUBLIC_VOLATO_RELEASE).toBe("abc123");
    // disableUpload still kills the webpack hook.
    expect((out as { webpack?: unknown }).webpack).toBeUndefined();
  });
});
