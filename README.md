# Volato CLI and generated integrations

Public tooling for [Volato](https://volato.dev), agent-native error context.

Customer applications do not install a Volato runtime package. The CLI carries
agent skills and deterministic framework recipes, then generates inspectable
source inside the application repository.

## Quickstart

```bash
npm install -g @volatodev/cli
volato login
volato init --project "<project_id>" --yes
volato errors init --yes --send-test-event
# after defining .volato/analytics.json
volato analytics init --yes
```

The installed domains cover production Errors and outcome-led Product
Analytics. `volato-errors` owns the investigation and correction job;
`volato-nextjs` owns the current capture integration; `volato-product` owns the
usage job. Generated
application source emits only contract-declared data;
the CLI does not expose a free-form event command.

For Next.js 15 and 16 App Router, setup generates:

```text
.agents/skills/        agent instructions
.volato/manifest.json project link and per-integration generated-file integrity
.volato/analytics.json versioned product data plan
src/volato/            local capture runtime when src/app is used
volato/                local capture runtime when app is used
```

The application keeps its existing Next.js and React dependencies. Generated
source sends plain HTTP events to Volato and uploads privacy-stripped
sourcemaps during production builds.

## Agent loop

After verified setup, ask the agent:

```text
Fix the latest production error.
```

The agent selects `volato-errors`, queries Volato, inspects source and Git, then
patches and verifies the cause. The underlying bounded primitives remain:

```bash
volato errors list
volato errors show
volato errors resolve <id> --note "verified in deployed release abc123"
```

Run `volato readme` for the complete agent-facing command contract.

## Development

```bash
pnpm install
pnpm build
pnpm test
pnpm smoke:nextjs
```

`pnpm smoke:nextjs` creates clean Next.js 15 and 16 applications, connects each
repository, initializes Errors and Analytics independently, sends an error test
event, builds for production and requires real sourcemap uploads without a
Volato runtime dependency.

## License

MIT — see [LICENSE](./LICENSE).
