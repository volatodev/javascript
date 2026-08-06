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

Volato provides operational skills and observability for AI agents. The CLI is
the primary surface for agents to install workflows, instrument outcomes, and
read, triage, and resolve errors from any terminal.

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

    volato init --project "<project_id>" --yes
    volato errors init --yes --send-test-event

\`volato init\` verifies access, installs \`volato-setup\`, \`volato-nextjs\` and
\`volato-product\`, then links the repository through
\`.volato/manifest.json\`. It does not detect a framework, write credentials or
instrument the app.

\`volato errors init\` retrieves the linked project's credentials and generates
local capture source for a Next.js 15 or 16 App Router project. No Volato
runtime dependency is added. Re-running is idempotent and refuses to overwrite
locally edited generated files.

The installed product domains are Next.js production errors and product-usage
analytics. Their authoritative application and platform transitions emit the
bounded events used by Volato; the CLI does not expose a free-form tracking
command.

## Project configuration

Replace the complete browser-origin allowlist after setup:

    volato projects origins set <project_id> https://app.example.com https://example.com
    volato projects origins set <project_id> --clear

The command canonicalises each URL to its \`scheme://host[:port]\` origin and
removes duplicates. \`--clear\` intentionally accepts browser events from
anywhere. Server-side Next.js and Node events are not filtered by this setting.
This is misuse reduction for a browser-safe DSN, not an authentication boundary.

## Product Analytics

The \`volato-product\` skill creates a versioned
\`.volato/analytics.json\` contract. Validate it, install the generated tracker,
then read the outcome-led report:

    volato analytics validate [--file <path>] [--json]
    volato analytics init [--file <path>] [--yes]
    volato analytics sync [--file <path>] [--json]
    volato analytics report [--file <path>] [--json]
    volato analytics snapshot save [--file <path>] [--json]

\`validate\` makes no network request. \`init\` publishes the approved contract,
generates a typed server tracker and records the \`analytics-nextjs\`
integration beside \`errors-nextjs\`. \`sync\` updates the active project
contract.
\`report\` returns activation, repeat-use, and retention evidence as agent-ready
markdown by default. \`snapshot save\` validates and saves only an explicitly
approved interpretation; reporting never saves one automatically.

## Reading errors

    volato errors init [--yes] [--send-test-event]
    volato errors list [--status <s>] [--release <r>] [--environment <env>] [--query <q>] [--project-id <id>] [--limit <n>] [--json]

Status filter: unresolved (default), resolved, ignored, all.

    volato errors show [<id>] [--project-id <id>] [--environment <env>] [--json]

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
    1   generic / local / Analytics error
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
