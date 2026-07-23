import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetReleaseCacheForTests,
  applyReleaseTo,
  detectDist,
  detectEnvironment,
  detectRelease,
} from "../internal/release";

beforeEach(() => {
  __resetReleaseCacheForTests();
});

afterEach(() => {
  vi.unstubAllEnvs();
  __resetReleaseCacheForTests();
});

describe("detectRelease", () => {
  it("reads VOLATO_RELEASE", () => {
    vi.stubEnv("VOLATO_RELEASE", "v1.2.3");
    expect(detectRelease()).toBe("v1.2.3");
  });

  it("falls back to NEXT_PUBLIC_VOLATO_RELEASE for browser builds", () => {
    vi.stubEnv("NEXT_PUBLIC_VOLATO_RELEASE", "browser-v1");
    expect(detectRelease()).toBe("browser-v1");
  });

  it("returns undefined when nothing is set", () => {
    expect(detectRelease()).toBeUndefined();
  });

  it("ignores empty / whitespace-only env values", () => {
    vi.stubEnv("VOLATO_RELEASE", "   ");
    vi.stubEnv("NEXT_PUBLIC_VOLATO_RELEASE", "fallback");
    expect(detectRelease()).toBe("fallback");
  });

  it("ignores provider-specific vars (no Vercel coupling)", () => {
    vi.stubEnv("VERCEL_GIT_COMMIT_SHA", "deadbeef");
    expect(detectRelease()).toBeUndefined();
  });
});

describe("detectEnvironment", () => {
  it("prefers VOLATO_ENVIRONMENT", () => {
    vi.stubEnv("VOLATO_ENVIRONMENT", "staging");
    vi.stubEnv("NODE_ENV", "development");
    expect(detectEnvironment()).toBe("staging");
  });

  it("falls back to NODE_ENV", () => {
    vi.stubEnv("NODE_ENV", "test");
    expect(detectEnvironment()).toBe("test");
  });
});

describe("detectDist", () => {
  it("reads VOLATO_DIST", () => {
    vi.stubEnv("VOLATO_DIST", "build-7");
    expect(detectDist()).toBe("build-7");
  });

  it("returns undefined when not set", () => {
    expect(detectDist()).toBeUndefined();
  });
});

describe("applyReleaseTo", () => {
  it("populates release/environment/dist on a bare event", () => {
    vi.stubEnv("VOLATO_RELEASE", "v1.0.0");
    vi.stubEnv("VOLATO_ENVIRONMENT", "production");
    vi.stubEnv("VOLATO_DIST", "build-1");
    const event: Record<string, unknown> = {};
    applyReleaseTo(event);
    expect(event).toEqual({
      release: "v1.0.0",
      environment: "production",
      dist: "build-1",
    });
  });

  it("does not overwrite explicit fields already on the event", () => {
    vi.stubEnv("VOLATO_RELEASE", "v1.0.0");
    const event: Record<string, unknown> = { release: "explicit" };
    applyReleaseTo(event);
    expect(event.release).toBe("explicit");
  });

  it("memoizes — repeated calls do not re-read process.env", () => {
    vi.stubEnv("VOLATO_RELEASE", "v1");
    expect(detectRelease()).toBe("v1");
    vi.stubEnv("VOLATO_RELEASE", "v2");
    // cache holds the first read; only resetting clears it
    expect(detectRelease()).toBe("v1");
  });
});
