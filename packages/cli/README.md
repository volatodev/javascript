# @volatodev/cli

The agent-facing CLI for [Volato](https://volato.dev) — agent-native error tracking.

Install it once. Your AI agent (Claude Code, Cursor, …) shells out to `volato` from any terminal to read, triage, and resolve errors — getting the full fix context (stack, originating commit, source location) in a single call.

## Install

```bash
npm install -g @volatodev/cli
```

## Authenticate

```bash
volato login              # browser code flow through app.volato.dev
volato whoami             # confirm the local credential exists
```

The token is stored at `~/.config/volato/credentials` (mode `0600`). Override the location with `VOLATO_CREDENTIALS_FILE` or the standard `XDG_CONFIG_HOME`.

## Commands

```bash
volato errors list                       # browse open error groups
volato errors show <id>                   # one-call fix context for a group
volato errors show                        # most-recent unresolved across the workspace
volato errors resolve <id> --note "..."  # mark resolved (append-only history)
volato errors reopen <id>
volato errors ignore <id>
volato skills install                     # install agent-facing setup skills
volato init --project <id> --yes --send-test-event
volato projects origins set <id> https://app.example.com
volato projects origins set <id> --clear
volato pmf validate                       # validate .volato/pmf.json locally
volato pmf sync                           # publish the outcome event catalog
volato pmf report                         # read activation and retention evidence
volato init --dsn <dsn> --yes             # advanced fallback without project lookup
volato readme                             # print every command (point your agent here)
```

Every command prints agent-ready markdown by default. Pass `--json` for the structured payload, scriptable exit codes for the rest (`3` auth, `4` not-found, `5` rate-limited).

Authenticated `volato init --project` retrieves the project DSN and server-only
ingest token without printing either credential, protects `.env.local`, installs
the setup skills, generates versioned source and records integrity hashes in
`.volato/manifest.json`. It adds no Volato runtime package.

The project-origins command replaces the complete browser-origin allowlist.
It canonicalises URLs, removes duplicates, and is safe for an agent to rerun.
`--clear` accepts browser events from any origin. This setting reduces casual
DSN misuse; it is not an authentication boundary and does not filter
server-side events.

The PMF commands use the versioned `.volato/pmf.json` contract. `validate`
performs the same structural checks as the API without making a request,
`sync` publishes the complete event catalog, and `report` reads outcome-led
activation, repeat-use, and retention evidence.

## For agents

Tell your agent to run `volato readme` once — it discovers the whole surface in a single call, then drives the loop: `errors list` → `errors show <id>` → fix → `errors resolve <id>`.

## Self-hosting

The API base defaults to `https://api.volato.dev` and is overridable for self-hosted deployments via `VOLATO_API_URL`.

## License

MIT © Wrenchy SASU
