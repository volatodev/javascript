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
volato errors init --yes
```

The public beta installs Volato Errors only. `volato-errors` owns the
investigation and correction job;
`volato-nextjs`, `volato-vite-react`, and `volato-node` own independent capture
integrations. Generated application source emits only contract-declared data.

Errors supports Next.js 15/16 App Router and Vite + React browser capture, with
independent Node.js runtime capture and Express HTTP context. A Vite frontend
does not imply Node: a project may install the browser adapter, the Node
adapter, or both.

Setup generates:

```text
.agents/skills/        agent instructions
.volato/manifest.json project link and per-integration generated-file integrity
src/volato/            local capture runtime when src/app is used
volato/                local capture runtime when app is used
src/volato/            also hosts the Vite + React browser runtime
src/volato-node/       Node runtime and Express adapter when detected
```

The application keeps its existing Next.js and React dependencies. Generated
source sends plain HTTP events to Volato and uploads privacy-stripped
sourcemaps during production builds.

## Agent loop

After verified setup, deploy the generated changes. When Volato reports a real
production error, ask the agent:

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
pnpm smoke:vite-node
```

`pnpm smoke:nextjs` creates clean Next.js 15 and 16 applications, connects each
repository, initializes Errors, sends an error test event, builds for
production and requires real sourcemap uploads without a Volato runtime
dependency.

`pnpm smoke:vite-node` creates a clean full-stack fixture, installs both
adapters through the packed CLI, builds Vite and Node, captures browser,
React, Express and fatal-process failures, and proves map privacy plus fatal
exit semantics.

## License

MIT — see [LICENSE](./LICENSE).
