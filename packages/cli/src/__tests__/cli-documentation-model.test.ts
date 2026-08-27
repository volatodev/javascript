import { describe, expect, it } from "vitest";
import { cliProgram } from "../cli.js";

function command(path: string[]) {
  let current = cliProgram;
  for (const name of path) {
    const next = current.commands.find((candidate) => candidate.name() === name);
    if (!next) throw new Error(`Missing Commander path: ${path.join(" ")}`);
    current = next;
  }
  return current;
}

describe("CLI documentation authority", () => {
  it("exposes the real Commander tree without parsing the test process", () => {
    expect(cliProgram.name()).toBe("volato");
    expect(command(["errors", "list"]).options.map(({ long }) => long)).toContain(
      "--cursor",
    );
    expect(command(["releases", "compare"]).options.map(({ long }) => long)).toContain(
      "--cursor",
    );
    expect(command(["projects", "list"]).options.map(({ long }) => long)).toContain(
      "--cursor",
    );
    expect(command(["errors", "init"]).options.map(({ long }) => long)).not.toContain(
      "--json",
    );
  });
});
