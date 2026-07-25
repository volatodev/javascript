import { describe, expect, it } from "vitest";
import { serializeEnvelope } from "../internal/serialize";

describe("serializeEnvelope", () => {
  it("serializes cyclic application context without throwing", () => {
    const extra: Record<string, unknown> = {};
    extra.self = extra;

    const result = serializeEnvelope({
      type: "Error",
      message: "boom",
      runtime: "rsc",
      timestamp: 1,
      extra,
    });

    expect(JSON.parse(result.body)).toMatchObject({
      message: "boom",
      volatoTruncated: true,
      extra: { self: "[Circular]" },
    });
  });

  it("normalizes BigInt and throwing getters", () => {
    const hostile = {
      count: 12n,
      get secret() {
        throw new Error("getter must not escape");
      },
    };

    expect(() => serializeEnvelope(hostile)).not.toThrow();
    expect(JSON.parse(serializeEnvelope(hostile).body)).toMatchObject({
      count: "12n",
      secret: "[Unserializable]",
      volatoTruncated: true,
    });
  });

  it("bounds the serialized envelope and preserves core fields", () => {
    const result = serializeEnvelope(
      {
        type: "TypeError",
        message: "important",
        runtime: "client",
        timestamp: 123,
        extra: { huge: "x".repeat(200_000) },
      },
      2_048,
    );

    expect(new TextEncoder().encode(result.body).byteLength).toBeLessThanOrEqual(
      2_048,
    );
    expect(JSON.parse(result.body)).toMatchObject({
      type: "TypeError",
      message: "important",
      runtime: "client",
      timestamp: 123,
      volatoTruncated: true,
    });
  });

  it("caps depth and collection cardinality", () => {
    const deep: Record<string, unknown> = {};
    let cursor = deep;
    for (let i = 0; i < 10; i += 1) {
      cursor.next = {};
      cursor = cursor.next as Record<string, unknown>;
    }

    const parsed = JSON.parse(
      serializeEnvelope({
        type: "Error",
        message: "boom",
        runtime: "rsc",
        timestamp: 1,
        deep,
        values: Array.from({ length: 100 }, (_, i) => i),
      }).body,
    ) as Record<string, unknown>;

    expect(parsed.volatoTruncated).toBe(true);
    expect((parsed.values as unknown[]).length).toBe(50);
    expect(JSON.stringify(parsed.deep)).toContain("[MaxDepth]");
  });
});
