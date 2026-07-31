# Volato CLI and generated integrations

Public tooling for [Volato](https://volato.dev), agent-native error context.

Customer applications do not install a Volato runtime package. The CLI carries
agent skills and deterministic framework recipes, then generates inspectable
source inside the application repository.

## Quickstart

```bash
npm install -g @volatodev/cli
volato login
volato skills install
volato init --project "<project_id>" --yes --send-test-event
```

The installed catalog includes the Next.js error, product-usage monitoring and
landing-page skills. Local skill workflows report only their bounded lifecycle
through `volato skills track`; customer-defined analytics events are not
accepted by that command.

For Next.js 15 and 16 App Router, setup generates:

```text
.agents/skills/        agent instructions
.volato/manifest.json generated-file integrity
src/volato/            local capture runtime when src/app is used
volato/                local capture runtime when app is used
```

The application keeps its existing Next.js and React dependencies. Generated
source sends plain HTTP events to Volato and uploads privacy-stripped
sourcemaps during production builds.

## Agent loop

```bash
volato errors list
volato errors show
volato errors resolve <id> --note "fixed in PR #123"
```

Run `volato readme` for the complete agent-facing command contract.

## Development

```bash
pnpm install
pnpm build
pnpm test
pnpm smoke:nextjs
```

`pnpm smoke:nextjs` creates clean Next.js 15 and 16 applications, runs the
authenticated project setup, sends a test event, builds for production and
requires real sourcemap uploads without a Volato runtime dependency.

## License

MIT — see [LICENSE](./LICENSE).
