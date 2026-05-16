/**
 * `volato` CLI entry point.
 *
 * Bundled with its deps (`commander`, `prompts`, `picocolors`) via tsup's
 * `noExternal` so end users do not pay any transitive install cost.
 */

import { Command } from "commander";
import { runInit } from "./cli/init";
import { runPurge } from "./cli/sourcemaps";
import { runUpload } from "./cli/sourcemaps-upload";

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

const sourcemaps = program
  .command("sourcemaps")
  .description("Manage sourcemaps for this project");

sourcemaps
  .command("upload")
  .description(
    "Walk the Next.js build output and POST every client `.js.map` to the ingest endpoint",
  )
  .option(
    "--token <token>",
    "Ingest token (falls back to VOLATO_INGEST_TOKEN)",
  )
  .option(
    "--endpoint <url>",
    "Override ingest origin (default: derived from NEXT_PUBLIC_VOLATO_DSN)",
  )
  .option(
    "--release <sha>",
    "Release tag for these maps (falls back to VOLATO_RELEASE)",
  )
  .option("--build-dir <dir>", "Next.js build directory (default `.next`)")
  .option(
    "--concurrency <n>",
    "Parallel uploads (default 8)",
    (v: string) => Number(v),
  )
  .action(
    async (opts: {
      token?: string;
      endpoint?: string;
      release?: string;
      buildDir?: string;
      concurrency?: number;
    }) => {
      try {
        const summary = await runUpload({
          token: opts.token,
          endpoint: opts.endpoint,
          release: opts.release,
          buildDir: opts.buildDir,
          concurrency: opts.concurrency,
        });
        // Exit non-zero on any failed upload so CI surfaces it.
        if (summary.failed > 0) process.exit(1);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        process.stderr.write(`volato: ${message}\n`);
        process.exit(1);
      }
    },
  );

sourcemaps
  .command("purge")
  .description(
    "Delete sourcemap rows + S3 objects (project-scoped; --release narrows further)",
  )
  .option(
    "--token <token>",
    "Ingest token (falls back to VOLATO_INGEST_TOKEN)",
  )
  .option(
    "--endpoint <url>",
    "Override ingest origin (default: derived from NEXT_PUBLIC_VOLATO_DSN)",
  )
  .option("--release <sha>", "Scope the purge to one release")
  .action(
    async (opts: {
      token?: string;
      endpoint?: string;
      release?: string;
    }) => {
      try {
        await runPurge({
          token: opts.token,
          endpoint: opts.endpoint,
          release: opts.release,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        process.stderr.write(`volato: ${message}\n`);
        process.exit(1);
      }
    },
  );

program.parseAsync(process.argv).catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`volato: ${message}\n`);
  process.exit(1);
});
