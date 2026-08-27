import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runReadme } from "../commands/readme.js";

const packageReadme = readFileSync(
  new URL("../../README.md", import.meta.url),
  "utf8",
);

afterEach(() => {
  vi.restoreAllMocks();
});

describe("public CLI documentation contract", () => {
  it("limits structured output to commands that actually expose --json", () => {
    const write = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);

    runReadme();

    const generated = String(write.mock.calls[0]?.[0]);
    for (const document of [packageReadme, generated]) {
      expect(document).toContain(
        "Commands with a `--json` option return agent-ready markdown",
      );
      expect(document).toContain(
        "Setup, authentication, skill installation, and this reference use command-specific terminal output",
      );
      expect(document).not.toMatch(/Every command prints agent-ready markdown/i);
    }
  });

  it("describes the API URL as an endpoint override, not a shipped hosting product", () => {
    expect(packageReadme).toContain("## Development endpoint override");
    expect(packageReadme).toContain("custom API endpoint");
    expect(packageReadme).not.toMatch(/self-host/i);
  });
});
