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
const publishWorkflow = readFileSync(
  new URL("../../../../.github/workflows/publish-beta.yml", import.meta.url),
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

  it("publishes a new CLI version from main through short-lived OIDC", () => {
    expect(publishWorkflow).toContain("packages/cli/package.json");
    expect(publishWorkflow).toContain("workflow_dispatch:");
    expect(publishWorkflow).toContain("id-token: write");
    expect(publishWorkflow).toContain("environment: npm-beta");
    expect(publishWorkflow).toContain(
      "npm publish --tag latest --access public",
    );
    expect(publishWorkflow).not.toContain("NPM_TOKEN");
  });

  it("gates before publishing and canaries the exact public artifact", () => {
    expect(publishWorkflow.indexOf("pnpm release:check")).toBeLessThan(
      publishWorkflow.indexOf("npm publish --tag latest --access public"),
    );
    expect(publishWorkflow).toContain(
      "node scripts/package-smoke.mjs \"$VOLATO_CLI_SPEC\"",
    );
    expect(publishWorkflow).toContain("node scripts/nextjs-conformance.mjs");
    expect(publishWorkflow).toContain(
      "node scripts/node-long-lived-conformance.mjs",
    );
    expect(publishWorkflow).toContain("node scripts/express-conformance.mjs");
    expect(publishWorkflow).toContain("node scripts/vite-node-conformance.mjs");
  });
});
