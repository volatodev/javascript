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

    volato login <token>    # token from https://app.volato.dev

The token is workspace-scoped and covers every project in the
workspace. Stored at ~/.config/volato/credentials (mode 0600).

## Install into a Next.js app

    volato init

Patches a Next.js 15 project — env vars, layout bootstrap,
instrumentation hook, optional tunnel route — and sends a test event
so you see capture land before your dev server has restarted.
Idempotent: re-running converges, never duplicates.

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

## Output

Every command prints agent-ready markdown by default. Pass --json
to get the structured payload instead. Both forms are stable
contracts.

## Environment

    VOLATO_API_URL              # override the API base (default https://api.volato.dev)
    VOLATO_CREDENTIALS_FILE     # override the credentials file path
    XDG_CONFIG_HOME             # base dir for ~/.config (honoured for credentials)

## Where things break

If you see "subscription_inactive (402)", your workspace's sub
lapsed. The token is still valid; reactivate at
https://app.volato.dev/billing and the CLI resumes immediately.

If you see "rate_limited (429)", the workspace is over 300 calls
per minute. The CLI retries are not automatic — back off and try
again in <60s.
`;

export function runReadme(): void {
  process.stdout.write(README);
}
