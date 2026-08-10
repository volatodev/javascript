import { describe, expect, it } from "vitest";
import { verificationRouteSource } from "../commands/init/verify-nextjs";

describe("generated Next.js verification route", () => {
  it("opts the temporary canary into development capture", () => {
    const source = verificationRouteSource(
      "../../../volato/server",
      "marker",
    );

    expect(source).toContain("initServer");
    expect(source).toContain(
      'initServer({ enabled: true, environment: "development" });',
    );
  });
});
