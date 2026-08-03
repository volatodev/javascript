# @volatodev/cli

The agent-facing CLI for [Volato](https://volato.dev) — operational skills and
observability for AI agents.

Install it once. Your AI coding agent shells out to `volato` from any terminal
to install workflows, instrument product outcomes, and resolve production
errors with source-aware context.

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
volato init --project <id> --yes          # connect repository + install skills
volato errors init --yes --send-test-event
volato analytics init --yes               # publish plan + generate typed tracker
volato projects origins set <id> https://app.example.com
volato projects origins set <id> --clear
volato analytics validate                 # validate .volato/analytics.json locally
volato analytics sync                     # publish the outcome event catalog
volato analytics report                   # read activation and retention evidence
volato analytics snapshot save            # save an approved interpretation
volato readme                             # print every command (point your agent here)
```

Upgrading from the former product-usage skill may report an installed-skill
conflict. Review it, then run `volato skills install --force` to replace the
bundled files and remove the retired `monitor-product-usage` directory.

Every command prints agent-ready markdown by default. Pass `--json` for the structured payload, scriptable exit codes for the rest (`3` auth, `4` not-found, `5` rate-limited).

Authenticated `volato init --project` verifies the project, installs the setup
skills and records a neutral project link in `.volato/manifest.json`. It does
not touch application source or runtime credentials. `volato errors init` and
`volato analytics init` then retrieve credentials without printing them and
own separate generated-file entries in the manifest. Neither adds a Volato
runtime package.

The project-origins command replaces the complete browser-origin allowlist.
It canonicalises URLs, removes duplicates, and is safe for an agent to rerun.
`--clear` accepts browser events from any origin. This setting reduces casual
DSN misuse; it is not an authentication boundary and does not filter
server-side events.

The product analytics commands use the versioned `.volato/analytics.json`
contract. `validate`
performs the same structural checks as the API without making a request,
`sync` publishes the complete event catalog, and `report` reads outcome-led
activation, repeat-use, and retention evidence. `snapshot save` validates
`.volato/analytics-snapshot.json` and saves it only after explicit approval.

## For agents

Tell your agent to run `volato readme` once — it discovers the whole surface in a single call, then drives the loop: `errors list` → `errors show <id>` → fix → `errors resolve <id>`.

## Self-hosting

The API base defaults to `https://api.volato.dev` and is overridable for self-hosted deployments via `VOLATO_API_URL`.

## License

MIT © Wrenchy SASU
