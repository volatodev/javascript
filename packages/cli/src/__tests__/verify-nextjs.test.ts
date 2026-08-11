import { describe, expect, it } from "vitest";
import {
  verificationFailureMessage,
  verificationRequestTimeoutMs,
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

  it("lets a cold Next.js route compile before retrying the capture", () => {
    expect(verificationRequestTimeoutMs(60_000)).toBe(15_000);
    expect(verificationRequestTimeoutMs(750)).toBe(750);
  });
});
