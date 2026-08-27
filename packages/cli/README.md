# @volatodev/cli

The agent-facing CLI for [Volato](https://volato.dev) — operational skills and
observability for AI agents.

Install it once. Your AI coding agent shells out to `volato` from any terminal
to install the Errors workflow and resolve production errors with source-aware
context.

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
volato errors list --release <r> --sort growth --json
volato errors show <id>                   # one-call fix context for a group
volato errors show                        # most-recent unresolved across the workspace
volato errors samples <id> --strategy all --json
volato releases list --json               # latest + previous captured releases
volato releases compare [head] --json     # new/aggravated/fixed groups
volato errors resolve <id> --note "..."  # mark resolved (append-only history)
volato errors reopen <id> --note "..."
volato errors ignore <id> --note "..."
volato skills install                     # install business + integration skills
volato init --project <id> --yes          # connect repository + install skills
volato errors init --yes --send-test-event
volato projects origins set <id> https://app.example.com
volato projects origins set <id> --clear
volato readme                             # print the public command contract
```

Upgrading from a former product-usage skill may report an installed-skill
conflict. Review it, then run `volato skills install --force` to replace the
bundled files and remove the retired `monitor-product-usage` and
`volato-product` directories.

Commands with a `--json` option return agent-ready markdown by default and the
structured payload when that option is present. Setup, authentication, skill installation, and this reference use command-specific terminal output. All
commands preserve scriptable failure classes (`3` auth, `4` not-found, `5`
rate-limited).

Authenticated `volato init --project` verifies the project, installs the setup
skills and records a neutral project link in `.volato/manifest.json`. It does
not touch application source or runtime credentials. `volato errors init` then
retrieves credentials without printing them and owns the generated-file
entries in the manifest. It adds no Volato runtime package.

Browser capture supports React 18/19 with Vite 6/7/8, Webpack 5 or Rspack 2,
plus client-rendered Vue 3 and Svelte 5 applications with Vite 6/7/8. Each
renderer has a separate skill and lifecycle hook. Nuxt, SvelteKit, SSR,
hydration and ambiguous roots remain explicit refusals.

The long-lived Node recipe targets conventional servers, jobs, and scripts on
Node 22/24, with TypeScript/JavaScript and package-declared ESM/CommonJS.
Express 4/5 context is composed only for the conformed same-file or split
app/listen topologies. Standalone Fastify 5 has its own conformed HTTP adapter.
NestJS 11/12 TypeScript HTTP applications use one delegated exception filter
above Express 5 or Fastify 5 and never install a competing transport adapter.
Unsupported or ambiguous HTTP composition remains an explicit refusal or
bounded generic-process result, never an inferred framework claim.

The provider-neutral invocation recipe targets asynchronous generic and Node
HTTP exports in root or `src/handler.{ts,js}` on the same Node 22/24,
TypeScript/JavaScript and ESM/CommonJS matrix. It preserves arguments, return
and rethrow identity, flushes within 2 seconds, remains safe across cold and
warm reuse, and installs no fatal process hook. Callback, synchronous and
streaming completion are refused before mutation. No cloud-provider preset is
advertised.

The project-origins command replaces the complete browser-origin allowlist.
It canonicalises URLs, removes duplicates, and is safe for an agent to rerun.
`--clear` accepts browser events from any origin. This setting reduces casual
DSN misuse; it is not an authentication boundary and does not filter
server-side events.

## For agents

After deploying a verified setup, wait until Volato reports a production
error, then ask your agent: `Fix the latest production error.` The
`volato-errors` skill queries Volato, inspects source and Git, patches the cause
and runs the available checks without requiring a copied email or dashboard
step. A local patch does not automatically resolve the production group.

For broad regressions, the agent can compare captured releases, rank groups by
new appearance, impact or raw event growth, and request a privacy-filtered,
bounded sample. The JSON is designed for temporary local `jq`/Node composition;
Volato does not execute arbitrary investigation code on customer data.

## Development endpoint override

The API base defaults to `https://api.volato.dev`. Set `VOLATO_API_URL` only
when development or conformance checks need a custom API endpoint; it does not
represent a separately supported hosting product.

## License

MIT © Wrenchy SASU
