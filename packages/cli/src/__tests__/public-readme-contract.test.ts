import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cliProgram } from "../cli.js";
import { buildReadme, runReadme } from "../commands/readme.js";

const packageReadme = readFileSync(
  new URL("../../README.md", import.meta.url),
  "utf8",
);

afterEach(() => {
  vi.restoreAllMocks();
});

describe("public CLI documentation contract", () => {
  it("renders every registered Commander command and option", () => {
    const generated = buildReadme(cliProgram);

    function verify(command: typeof cliProgram, parent: string[]): void {
      const path = [...parent, command.name()];
      if (parent.length > 0) {
        expect(generated).toContain(`### \`${path.join(" ")}\``);
      }
      for (const option of command.createHelp().visibleOptions(command)) {
        expect(generated).toContain(`\`${option.flags}\``);
      }
      for (const child of command.commands) verify(child, path);
    }

    verify(cliProgram, []);
  });

  it("limits structured output to commands that actually expose --json", () => {
    const write = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);

    runReadme(cliProgram);

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
