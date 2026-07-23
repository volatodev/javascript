import { describe, expect, it } from "vitest";
import { scrubSearchParams, scrubUrl } from "../internal/scrub-url";

describe("scrubUrl", () => {
  it("returns the URL unchanged when there is no query string", () => {
    expect(scrubUrl("/api/users")).toBe("/api/users");
    expect(scrubUrl("https://app.example.com/page")).toBe(
      "https://app.example.com/page",
    );
  });

  it("returns the URL unchanged when no param is sensitive", () => {
    expect(scrubUrl("/api/users?page=2&sort=asc")).toBe(
      "/api/users?page=2&sort=asc",
    );
  });

  it("redacts a single sensitive param", () => {
    expect(scrubUrl("/api/users?email=foo@bar.com")).toBe(
      "/api/users?email=[FILTERED]",
    );
    expect(scrubUrl("/api/auth?token=abc123")).toBe(
      "/api/auth?token=[FILTERED]",
    );
  });

  it("redacts case-insensitively", () => {
    expect(scrubUrl("/api/users?Email=foo@bar.com")).toBe(
      "/api/users?Email=[FILTERED]",
    );
    expect(scrubUrl("/api/users?EMAIL=foo@bar.com")).toBe(
      "/api/users?EMAIL=[FILTERED]",
    );
  });

  it("redacts camelCase and snake_case variants via substring match", () => {
    expect(scrubUrl("/api/users?userEmail=foo@bar.com")).toBe(
      "/api/users?userEmail=[FILTERED]",
    );
    expect(scrubUrl("/api/auth?accessToken=abc")).toBe(
      "/api/auth?accessToken=[FILTERED]",
    );
    expect(scrubUrl("/api/auth?api_key=xyz")).toBe(
      "/api/auth?api_key=[FILTERED]",
    );
    expect(scrubUrl("/api/auth?apiKey=xyz")).toBe(
      "/api/auth?apiKey=[FILTERED]",
    );
  });

  it("does NOT redact close-but-innocent param names", () => {
    // `key` alone is too broad — would scrub `monkey`. We don't match it.
    expect(scrubUrl("/zoo?monkey=banana")).toBe("/zoo?monkey=banana");
    // `auth` alone would scrub `author`. We don't match it.
    expect(scrubUrl("/posts?author=alice")).toBe("/posts?author=alice");
  });

  it("redacts multiple sensitive params in one URL", () => {
    expect(scrubUrl("/api/login?email=a@b.com&password=hunter2&next=/")).toBe(
      "/api/login?email=[FILTERED]&password=[FILTERED]&next=/",
    );
  });

  it("preserves the path, fragment, and non-sensitive params", () => {
    expect(
      scrubUrl("/api/users?page=2&token=abc&sort=asc#section"),
    ).toBe("/api/users?page=2&token=[FILTERED]&sort=asc#section");
  });

  it("works with absolute URLs", () => {
    expect(
      scrubUrl("https://app.example.com/dashboard?session=xyz&view=grid"),
    ).toBe("https://app.example.com/dashboard?session=[FILTERED]&view=grid");
  });

  it("handles a param with no value", () => {
    expect(scrubUrl("/api/users?token&debug")).toBe(
      "/api/users?token=[FILTERED]&debug",
    );
  });

  it("handles URL-encoded names", () => {
    expect(scrubUrl("/api/users?user%5Femail=foo@bar.com")).toBe(
      "/api/users?user%5Femail=[FILTERED]",
    );
  });

  it("returns the URL unchanged for a malformed encoded name", () => {
    // `%E0%A4%A` is an incomplete escape — decodeURIComponent throws. We
    // fall back to the raw name, which doesn't match anything sensitive.
    expect(scrubUrl("/api/users?%E0%A4%A=v")).toBe("/api/users?%E0%A4%A=v");
  });

  it("redacts the standard credential-family params", () => {
    const cases: Array<[string, string]> = [
      ["password", "password"],
      ["pwd", "pwd"],
      ["passwd", "passwd"],
      ["jwt", "jwt"],
      ["secret", "secret"],
      ["authorization", "authorization"],
      ["bearer", "bearer"],
      ["session", "session"],
      ["sessid", "sessid"],
      ["apikey", "apikey"],
      ["api-key", "api-key"],
    ];
    for (const [name] of cases) {
      expect(scrubUrl(`/x?${name}=v`)).toBe(`/x?${name}=[FILTERED]`);
    }
  });
});

describe("scrubSearchParams", () => {
  it("returns the same reference when nothing is sensitive", () => {
    const input = { page: "2", sort: "asc" };
    expect(scrubSearchParams(input)).toBe(input);
  });

  it("redacts a single sensitive key (string value)", () => {
    expect(scrubSearchParams({ email: "foo@bar.com", page: "2" })).toEqual({
      email: "[FILTERED]",
      page: "2",
    });
  });

  it("redacts every value when the value is an array", () => {
    expect(
      scrubSearchParams({ token: ["a", "b", "c"], view: "grid" }),
    ).toEqual({
      token: ["[FILTERED]", "[FILTERED]", "[FILTERED]"],
      view: "grid",
    });
  });

  it("matches camelCase / snake_case via substring", () => {
    expect(
      scrubSearchParams({
        userEmail: "x",
        accessToken: "y",
        api_key: "z",
        ok: "ok",
      }),
    ).toEqual({
      userEmail: "[FILTERED]",
      accessToken: "[FILTERED]",
      api_key: "[FILTERED]",
      ok: "ok",
    });
  });

  it("does NOT mutate the original record when scrubbing happens", () => {
    const input = { email: "foo@bar.com", page: "2" };
    const out = scrubSearchParams(input);
    expect(input.email).toBe("foo@bar.com");
    expect(out).not.toBe(input);
  });
});
