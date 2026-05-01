#!/usr/bin/env node
import { Command } from "commander";
import pc from "picocolors";

const program = new Command();

program
  .name("volato")
  .description("Volato CLI — install and patch Volato into your Next.js project")
  .version("0.0.0");

program
  .command("init")
  .description("Initialize Volato in the current Next.js project")
  .action(() => {
    console.log(pc.cyan("volato init — coming in phase 2"));
  });

program
  .command("patch")
  .description("Patch existing Next.js files to wire up Volato")
  .action(() => {
    console.log(pc.cyan("volato patch — coming in phase 2"));
  });

program
  .command("detect")
  .description("Detect the current Next.js project configuration")
  .action(() => {
    console.log(pc.cyan("volato detect — coming in phase 2"));
  });

program.parseAsync(process.argv).catch((err) => {
  console.error(pc.red(`volato: ${err instanceof Error ? err.message : String(err)}`));
  process.exit(1);
});
