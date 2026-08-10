---
name: volato-setup
description: Connect a repository to Volato, inspect its project link, and select an Errors or Analytics integration skill. Use when an agent is asked to initialize Volato, when volato-errors delegates missing capture setup, or when a generated integration must be repaired or verified.
---

# Set up Volato

Keep each integration inside the developer's repository and prove its complete
data path. Do not invent capture code from scratch.

## Workflow

1. Inspect `package.json`, framework configuration, source layout, build
   scripts and existing `.volato/manifest.json`.
2. Run `volato init --project <id>` from the application root. This links the
   repository and installs the bundled skills; it must not modify application
   source or write runtime credentials.
3. Select the requested integration. For Next.js error capture, follow
   `volato-nextjs` and run `volato errors init`. For product analytics, follow
   `volato-product`, define `.volato/analytics.json`, and run
   `volato analytics init`. Stop with a clear unsupported-framework result when
   no adapter applies.
4. Review every file change reported by the selected integration before
   continuing.
5. Inspect deployment config and public application/auth URL variables. When
   the browser-facing production origins are unambiguous, replace the project
   allowlist with `volato projects origins set <id> <origin...>`. Do not add API
   or ingest origins unless the browser application is actually served there.
   If deployment identity is ambiguous, leave the current policy unchanged and
   report the single missing decision instead of guessing.
6. Confirm that no Volato runtime dependency was added.
7. Build the application and run the framework skill's conformance checks.
8. Verify the selected integration's delivery path.
9. For Errors, verify a production sourcemap when build credentials are
   available.
10. Report the generated files, configured browser origins, any manual
   integration points, and every check
   that could not be completed.
11. After verified Errors setup, return control to `volato-errors` when setup
    was delegated from an investigation. Otherwise finish with: `Volato Errors
    is ready. Now ask your agent: “Fix the latest production error.”`

Read [references/protocol.md](references/protocol.md) before changing
transport, credentials, event fields, privacy filtering or sourcemap upload.

## Guardrails

- Treat `.volato/manifest.json` as the project link and generated-file
  ownership record. Each integration owns only its own manifest entry.
- Never overwrite a generated file whose hash differs from the manifest.
- Never expose `VOLATO_INGEST_TOKEN` to browser code.
- Never upload source text.
- Treat allowed origins as browser DSN misuse reduction, not authentication.
- Never declare success from file generation alone; compile and exercise the
  capture path.
- Keep unsupported capture surfaces explicit. Partial silent coverage violates
  the Volato contract.
