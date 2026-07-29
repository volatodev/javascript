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
4. Inspect deployment config and public application/auth URL variables. When
   the browser-facing production origins are unambiguous, replace the project
   allowlist with `volato projects origins set <id> <origin...>`. Do not add API
   or ingest origins unless the browser application is actually served there.
   If deployment identity is ambiguous, leave the current policy unchanged and
   report the single missing decision instead of guessing.
5. Confirm that no Volato runtime dependency was added.
6. Build the application and run the framework skill's conformance checks.
7. Send a synthetic error and confirm the ingest response.
8. Verify a production sourcemap when build credentials are available.
9. Report the generated files, configured browser origins, any manual
   integration points, and every check
   that could not be completed.

Read [references/protocol.md](references/protocol.md) before changing
transport, credentials, event fields, privacy filtering or sourcemap upload.

## Guardrails

- Treat `.volato/manifest.json` as the generated-file ownership record.
- Never overwrite a generated file whose hash differs from the manifest.
- Never expose `VOLATO_INGEST_TOKEN` to browser code.
- Never upload source text.
- Treat allowed origins as browser DSN misuse reduction, not authentication.
- Never declare success from file generation alone; compile and exercise the
  capture path.
- Keep unsupported capture surfaces explicit. Partial silent coverage violates
  the Volato contract.
