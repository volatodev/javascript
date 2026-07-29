---
name: volato-setup
description: Set up, inspect, update, or verify Volato error capture in an application with generated local source and no Volato runtime dependency. Use when an agent is asked to connect a repository to Volato, repair its generated integration, verify event delivery, or select the correct framework-specific Volato skill.
---

# Set up Volato

Keep the setup inside the developer's repository and prove the complete data
path. Do not invent capture code from scratch.

## Workflow

1. Inspect `package.json`, framework configuration, source layout, build
   scripts and existing `.volato/manifest.json`.
2. Select a bundled framework skill. Stop with a clear unsupported-framework
   result when none applies.
3. Run `volato init --project <id>` from the application root. Review every
   reported file change before continuing. Use `--dsn` only when authenticated
   project lookup is intentionally unavailable.
4. Confirm that no Volato runtime dependency was added.
5. Build the application and run the framework skill's conformance checks.
6. Send a synthetic error and confirm the ingest response.
7. Verify a production sourcemap when build credentials are available.
8. Report the generated files, any manual integration points, and every check
   that could not be completed.

Read [references/protocol.md](references/protocol.md) before changing
transport, credentials, event fields, privacy filtering or sourcemap upload.

## Guardrails

- Treat `.volato/manifest.json` as the generated-file ownership record.
- Never overwrite a generated file whose hash differs from the manifest.
- Never expose `VOLATO_INGEST_TOKEN` to browser code.
- Never upload source text.
- Never declare success from file generation alone; compile and exercise the
  capture path.
- Keep unsupported capture surfaces explicit. Partial silent coverage violates
  the Volato contract.
