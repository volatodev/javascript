import { describe, expect, it } from "vitest";
import { ErrorEventSchema } from "../wire";

const baseEvent = {
  type: "TypeError",
  message: "boom",
  runtime: "client" as const,
  timestamp: 1700000000000,
};

describe("ErrorEventSchema (legacy fields)", () => {
  it("accepts the minimum required event", () => {
    expect(ErrorEventSchema.safeParse(baseEvent).success).toBe(true);
  });

  it("rejects unknown runtime values", () => {
    expect(
      ErrorEventSchema.safeParse({ ...baseEvent, runtime: "unknown" }).success,
    ).toBe(false);
  });

  it("preserves passthrough fields not declared in the schema", () => {
    const parsed = ErrorEventSchema.parse({
      ...baseEvent,
      somethingNew: { weird: true },
    }) as Record<string, unknown>;
    expect(parsed.somethingNew).toEqual({ weird: true });
  });
});

describe("ErrorEventSchema (extended context)", () => {
  it("accepts level, release, dist, environment", () => {
    const ev = {
      ...baseEvent,
      level: "warning" as const,
      release: "myapp@1.2.3",
      dist: "build-42",
      environment: "production",
    };
    const parsed = ErrorEventSchema.parse(ev);
    expect(parsed.level).toBe("warning");
    expect(parsed.release).toBe("myapp@1.2.3");
    expect(parsed.dist).toBe("build-42");
  });

  it("rejects an invalid level", () => {
    expect(
      ErrorEventSchema.safeParse({ ...baseEvent, level: "critical" }).success,
    ).toBe(false);
  });

  it("accepts user context (id/email/username/ip_address)", () => {
    const parsed = ErrorEventSchema.parse({
      ...baseEvent,
      user: {
        id: "user_abc",
        email: "alice@example.com",
        username: "alice",
        ip_address: "{{auto}}",
      },
    });
    expect(parsed.user?.email).toBe("alice@example.com");
  });

  it("accepts tags as a flat string→string map", () => {
    const parsed = ErrorEventSchema.parse({
      ...baseEvent,
      tags: { feature: "checkout", region: "eu-west-1" },
    });
    expect(parsed.tags?.feature).toBe("checkout");
  });

  it("rejects non-string tag values", () => {
    expect(
      ErrorEventSchema.safeParse({
        ...baseEvent,
        tags: { count: 42 as unknown as string },
      }).success,
    ).toBe(false);
  });

  it("accepts contexts as nested record-of-records", () => {
    const parsed = ErrorEventSchema.parse({
      ...baseEvent,
      contexts: {
        browser: { name: "Chrome", version: "131" },
        os: { name: "macOS", version: "14.5" },
        custom: { whatever: ["a", "b"] },
      },
    });
    expect(parsed.contexts?.browser?.name).toBe("Chrome");
    expect(parsed.contexts?.custom?.whatever).toEqual(["a", "b"]);
  });

  it("accepts a fingerprint override (array of strings)", () => {
    const parsed = ErrorEventSchema.parse({
      ...baseEvent,
      fingerprint: ["{{ default }}", "checkout-flow"],
    });
    expect(parsed.fingerprint).toEqual(["{{ default }}", "checkout-flow"]);
  });

  it("accepts breadcrumbs with timestamps + arbitrary data", () => {
    const parsed = ErrorEventSchema.parse({
      ...baseEvent,
      breadcrumbs: [
        {
          timestamp: 1700000000000,
          category: "navigation",
          message: "from /a to /b",
          level: "info",
        },
        {
          timestamp: 1700000000500,
          category: "fetch",
          data: { url: "/api/x", status: 500 },
        },
      ],
    });
    expect(parsed.breadcrumbs?.length).toBe(2);
    expect(parsed.breadcrumbs?.[1]?.data?.status).toBe(500);
  });

  it("accepts linkedErrors as a flat causal chain", () => {
    const parsed = ErrorEventSchema.parse({
      ...baseEvent,
      linkedErrors: [
        { type: "DBError", message: "timeout" },
        { type: "Error", message: "outer wrap", stack: null },
      ],
    });
    expect(parsed.linkedErrors?.length).toBe(2);
    expect(parsed.linkedErrors?.[0]?.type).toBe("DBError");
  });

  it("accepts sdk identification", () => {
    const parsed = ErrorEventSchema.parse({
      ...baseEvent,
      sdk: { name: "@volatodev/nextjs", version: "0.0.0" },
    });
    expect(parsed.sdk?.name).toBe("@volatodev/nextjs");
  });

  it("accepts free-form extra blob", () => {
    const parsed = ErrorEventSchema.parse({
      ...baseEvent,
      extra: { cartItems: 3, lastAction: "click-submit" },
    });
    expect(parsed.extra?.cartItems).toBe(3);
  });
});
