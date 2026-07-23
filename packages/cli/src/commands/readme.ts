/**
 * `volato readme` — print the full command surface as markdown.
 *
 * The point of this command: an AI agent that's never seen Volato
 * before runs `volato readme` and gets every command + flag + env
 * knob in one call. Equivalent of `tools/list` for an MCP server,
 * except the CLI works in any terminal without client config. Keep
 * the output stable and machine-friendly; this is part of the contract.
 */

const README = `# volato — Volato CLI

Volato is agent-native error tracking. The CLI is the primary surface
for AI agents to read, triage, and resolve errors. Use it from any
terminal or have your agent shell out.

## Setup

    volato login            # opens app.volato.dev/cli, paste the code it shows

Browser code flow: \`login\` sends you to a page that shows a one-time
code; paste it back and the CLI exchanges it for the workspace token.
The token is workspace-scoped (covers every project) and stored at
~/.config/volato/credentials (mode 0600).

Headless / CI — skip \`login\` and set the token in the environment:

    export VOLATO_TOKEN=...        # the API client reads it directly
    echo "$VOLATO_TOKEN" | volato login --stdin   # or store it once

## Install into a Next.js app

    volato skills install
    volato init --dsn "https://<public_key>@api.volato.dev/<project_id>" --yes

Installs the generic and Next.js agent skills, then generates local capture
source in a Next.js 15 App Router project. No Volato runtime dependency is
added. The recipe patches env vars, layout bootstrap, instrumentation hook,
tunnel route and build-time sourcemap upload. Re-running is idempotent and
refuses to overwrite locally edited generated files.

Add \`--send-test-event\` to a non-interactive init when network verification
is wanted immediately.

## Reading errors

    volato errors list [--status <s>] [--release <r>] [--query <q>] [--project-id <id>] [--limit <n>] [--json]

Status filter: unresolved (default), resolved, ignored, all.

    volato errors show [<id>] [--project-id <id>] [--json]

Returns the one-call fix context for an error group: stack,
breadcrumbs, commit transition, source pointer, affected users,
and similar previously-resolved groups.

Omit the id to get the most recent unresolved group across the
workspace (or scoped to --project-id). This is the painkiller path
for "fix the last error" — one call, everything an agent needs.

## Triaging

    volato errors resolve <id> [--note "fixed in PR #123"] [--json]
    volato errors reopen  <id> [--note "regression — needs more work"] [--json]
    volato errors ignore  <id> [--note "flaky third-party API"] [--json]

The note is persisted on the resolution history (append-only —
reopen does NOT erase prior notes; the full history surfaces in
\`volato errors show\`).

## Auth

    volato whoami            # confirm a token is loaded
    volato logout            # remove the stored token

## Output

Every command prints agent-ready markdown by default. Pass --json
to get the structured payload instead. Both forms are stable
contracts.

## Exit codes

    0   success
    1   generic / local / usage error
    3   auth — token missing or invalid (401), or subscription inactive (402)
    4   not found — no such error group or project (404)
    5   rate limited (429) — back off and retry

Branch on these instead of parsing stderr: re-login on 3, back off
on 5, stop on 4.

## Environment

    VOLATO_TOKEN                # workspace token; used directly when no credentials file (headless/CI)
    VOLATO_API_URL              # override the API base (default https://api.volato.dev)
    VOLATO_APP_URL              # override the dashboard base for login (default https://app.volato.dev)
    VOLATO_CREDENTIALS_FILE     # override the credentials file path
    XDG_CONFIG_HOME             # base dir for ~/.config (honoured for credentials)

## Where things break

If you see "subscription_inactive (402)", your workspace's sub
lapsed. The token is still valid; reactivate at
https://app.volato.dev/billing and the CLI resumes immediately.

Transient failures (network errors, 502/503/504) are retried
automatically — up to 2 quick backoffs — and every request times out
after 30s. A "rate_limited (429)" is NOT auto-retried: the workspace
is over 300 calls/minute. Back off and retry after the Retry-After
window the CLI prints (typically <60s).
`;

export function runReadme(): void {
  process.stdout.write(README);
}
