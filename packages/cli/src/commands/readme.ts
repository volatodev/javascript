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

Volato Errors gives coding agents the production evidence needed to investigate
and fix real errors. The CLI installs capture, reads bounded evidence, and
performs explicit lifecycle mutations from any terminal.

## Setup

    volato login            # opens app.volato.dev/cli, paste the code it shows

Browser code flow: \`login\` sends you to a page that shows a one-time
code; paste it back and the CLI exchanges it for the workspace token.
The token is workspace-scoped (covers every project) and stored at
~/.config/volato/credentials (mode 0600).

Headless / CI — skip \`login\` and set the token in the environment:

    export VOLATO_TOKEN=...        # the API client reads it directly
    echo "$VOLATO_TOKEN" | volato login --stdin   # or store it once

## Install Errors capture

    volato init --project "<project_id>" --yes
    volato errors init --yes

\`volato init\` verifies access, installs \`volato-setup\`, \`volato-errors\`,
\`volato-nextjs\`, \`volato-vite-react\` and \`volato-node\`, then links the repository through
\`.volato/manifest.json\`. It does not detect a framework, write credentials or
instrument the app.

\`volato errors init\` retrieves the linked project's credentials and generates
the applicable independent adapters: Next.js 15/16 App Router or Pages Router,
React browser capture with Vite, Webpack, or Rspack, and Node.js runtime capture
for conventional servers, jobs, and scripts on Node 22/24 across
TypeScript/JavaScript and package-declared ESM/CommonJS. Express 4/5 HTTP
context covers the conformed same-file and split app/listen topologies. A
browser build tool alone never implies a Node server. No Volato runtime
dependency is added. Re-running is idempotent and refuses to overwrite locally
edited generated files. \`--send-test-event\` is the built-in Next.js verifier;
the browser and Node skills define their production-build conformance scenarios.

Errors is the only public product. \`volato-errors\` owns the investigation job
while the framework skills own capture integration. The CLI does not expose a
free-form tracking command.

## Project configuration

Replace the complete browser-origin allowlist after setup:

    volato projects list [--limit <n>] [--cursor <cursor>] [--json]
    volato projects origins set <project_id> https://app.example.com https://example.com
    volato projects origins set <project_id> --clear

The command canonicalises each URL to its \`scheme://host[:port]\` origin and
removes duplicates. \`--clear\` intentionally accepts browser events from
anywhere. Server-side Next.js and Node events are not filtered by this setting.
This is misuse reduction for a browser-safe DSN, not an authentication boundary.

## Reading errors

    volato errors init [--yes] [--send-test-event]
    volato errors list [--status <s>] [--release <r>] [--runtime <runtime>] [--route <route>] [--min-events <n>] [--min-users <n>] [--sort recent|new|users|events|growth] [--project-id <id>] [--limit <n>] [--cursor <cursor>] [--json]

Status filter: unresolved (default), resolved, ignored, all.

    volato errors show [<id>] [--project-id <id>] [--environment <env>] [--json]
    volato errors samples <id> [--release <r>] [--runtime <runtime>] [--route <route>] [--strategy all|recent|representative|variations] [--limit <n>] [--json]

    volato releases list [--project-id <id>] [--runtime <runtime>] [--limit <n>] [--cursor <cursor>] [--json]
    volato releases compare [<head>] [--base <release>] [--project-id <id>] [--runtime <runtime>] [--limit <n>] [--cursor <cursor>] [--json]

Returns the one-call fix context for an error group: stack,
breadcrumbs, commit transition, source pointer, affected users,
and similar previously-resolved groups.

Omit the id to get the most recent unresolved group across the
workspace (or scoped to --project-id). This is the painkiller path
for "fix the last error" — one call, everything an agent needs.

After verified setup, deploy the generated changes. When Volato reports a real
production error, ask the coding agent: "Fix the latest production error." The
\`volato-errors\` skill selects the read path, inspects local source and Git,
patches and tests the cause, and keeps resolution separate from investigation.
When the read-only Volato MCP connection is available, the skill uses its six
bounded read tools; otherwise it uses these CLI commands with \`--json\`. It
does not repeat the same evidence read through both channels. Installation,
local source work, tests, Git, and explicit status mutations remain CLI/shell
operations.

For a broad post-deploy regression, compare the latest and previous captured
releases, rank new/aggravated groups, then request only bounded representative
event samples. Release growth is a raw captured-event comparison, not a
traffic-normalized rate. Sample output excludes request bodies, cookies,
headers, query values, arbitrary tags, and user identity.

## Triaging

    volato errors resolve <id> --note "fixed in PR #123" [--json]
    volato errors reopen  <id> --note "regression — needs more work" [--json]
    volato errors ignore  <id> --note "flaky third-party API" [--json]

The note is persisted on the resolution history (append-only —
reopen does NOT erase prior notes; the full history surfaces in
\`volato errors show\`).

A locally verified patch is not proof that production recovered. Do not mark a
group resolved until sufficient deployment evidence exists or the user makes
that status mutation explicit.

## Auth

    volato whoami            # confirm a token is loaded
    volato logout            # remove the stored token

## Output

Every command prints agent-ready markdown by default. Pass --json
to get the structured payload instead. Both forms are stable
contracts.

Paginated reads return \`nextCursor\` in JSON. Pass that value unchanged to
\`--cursor\` to continue; cursors are scoped to the same filters and ordering.

## Exit codes

    0   success
    1   generic / local error
    3   auth — token missing or invalid (401)
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

If a project is paused after a Starter-to-Free downgrade, select the active
Free project or upgrade capacity from https://app.volato.dev/settings/billing.

Transient failures (network errors, 502/503/504) are retried
automatically — up to 2 quick backoffs — and every request times out
after 30s. A "rate_limited (429)" is NOT auto-retried: the workspace
is over 300 calls/minute. Back off and retry after the Retry-After
window the CLI prints (typically <60s).
`;

export function runReadme(): void {
  process.stdout.write(README);
}
