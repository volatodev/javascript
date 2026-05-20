/**
 * `volato` CLI entry point.
 *
 * Bundled with its deps (`commander`, `prompts`, `picocolors`) via tsup's
 * `noExternal` so end users do not pay any transitive install cost.
 */

import { Command } from "commander";
import { runInit } from "./cli/init";

const program = new Command();

program
  .name("volato")
  .description("Volato CLI — install error tracking into a Next.js app");

program
  .command("init")
  .description("Wire @volatodev/nextjs into the current Next.js project")
  .action(async () => {
    try {
      await runInit({ cwd: process.cwd() });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(`volato: ${message}\n`);
      process.exit(1);
    }
  });

program.parseAsync(process.argv).catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`volato: ${message}\n`);
  process.exit(1);
});
