import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const releaseCheck = readFileSync(
  new URL("../../../../scripts/release-check.mjs", import.meta.url),
  "utf8",
);
const releaseBeta = readFileSync(
  new URL("../../../../scripts/release-beta-local.mjs", import.meta.url),
  "utf8",
);

describe("release artifact gates", () => {
  it("runs clean-app conformance from the packed candidate", () => {
    expect(releaseCheck).toContain('VOLATO_CLI_SPEC: "pack"');
  });

  it("runs clean-app conformance from the exact registry version before promotion", () => {
    expect(releaseBeta).toContain("VOLATO_CLI_SPEC: packageSpec");
    expect(releaseBeta.indexOf('verifyTagWithRetries("latest")')).toBeGreaterThan(
      releaseBeta.indexOf("VOLATO_CLI_SPEC: packageSpec"),
    );
  });

  it("retries registry reads around publication and dist-tag propagation", () => {
    expect(releaseBeta).toContain("verifyVersionWithRetries");
    expect(releaseBeta).toContain("verifyTagWithRetries");
    expect(releaseBeta.indexOf("verifyVersionWithRetries(packageSpec)")).toBeLessThan(
      releaseBeta.indexOf('"scripts/package-smoke.mjs", packageSpec'),
    );
  });
});
