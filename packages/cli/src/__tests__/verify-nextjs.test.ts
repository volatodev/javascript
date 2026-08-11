import { describe, expect, it } from "vitest";
import {
  verificationFailureMessage,
  verificationRouteSource,
} from "../commands/init/verify-nextjs";

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

  it("keeps the Next.js transport logs when ingest rejects the canary", () => {
    expect(
      verificationFailureMessage(
        "ingest did not accept the generated capture",
        "[Volato] Server reason: invalid_dsn",
      ),
    ).toBe(
      "ingest did not accept the generated capture\n[Volato] Server reason: invalid_dsn",
    );
  });
});
