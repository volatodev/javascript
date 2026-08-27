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
investigation and correction job. `volato-nextjs`, `volato-vite-react`,
`volato-vite-vue`, `volato-vite-svelte`, `volato-node`, `volato-fastify`, and
`volato-nestjs` own independent bounded capture integrations. Generated
application source emits only contract-declared data.

Errors supports JavaScript and TypeScript Next.js 15/16 App Router, Pages
Router, and hybrid App + Pages applications; React 18/19 browser capture with
Vite, Webpack, or Rspack; and Vite 6/7/8 client SPAs using Vue 3 or Svelte 5.
Node.js runtime capture remains independent, with bounded Express 4/5,
standalone Fastify 5, and NestJS 11/12 HTTP adapters. A Vite frontend does not
imply Node: a project may install one browser adapter, one server adapter, or
both.

The long-lived Node contract covers maintained Node 22/24, conventional
servers, jobs and scripts, TypeScript/JavaScript, and package-declared
ESM/CommonJS. Express 4/5 and Fastify 5 add HTTP context for their conformed
same-file and split app/listen topologies while preserving application-owned
error handlers and responses. NestJS 11/12 covers conventional TypeScript HTTP
applications on Express 5 or Fastify 5 and remains the sole HTTP capture owner
above either transport.

Provider-neutral Node invocation capture covers asynchronous generic and Node
HTTP handlers on the same Node 22/24, TypeScript/JavaScript and ESM/CommonJS
matrix. It preserves success returns and original failures, performs one
bounded end-of-invocation flush, and proves cold, warm and concurrent reuse.
Callback, synchronous and streaming completion remain explicit refusals; no
cloud-provider preset is claimed.

Setup generates:

```text
.agents/skills/        agent instructions
.volato/manifest.json project link and per-integration generated-file integrity
src/volato/            local browser runtime for supported renderer adapters
volato/                local capture runtime when app is used
src/volato-node/       Node runtime and selected HTTP adapter when detected
src/volato-invocation/ provider-neutral Node invocation runtime when detected
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
pnpm exec playwright install chromium
pnpm build
pnpm test
pnpm smoke:nextjs
pnpm smoke:browser-react
pnpm smoke:browser-renderers
pnpm smoke:node-long-lived
pnpm smoke:express
pnpm smoke:fastify
pnpm smoke:nest
pnpm smoke:node-invocation
pnpm smoke:vite-node
pnpm smoke:framework-stacks
```

`pnpm smoke:nextjs` creates clean JavaScript and TypeScript Next.js 15 and 16
App Router, Pages Router, and hybrid applications, connects each repository,
initializes Errors, exercises router-specific browser and server failures,
uses root and `src/` layouts plus ESM, TypeScript, CommonJS, missing-config,
standalone and standard-server topologies, builds for production and requires
privacy-cleaned sourcemap uploads plus exact source-file/line resolution for
every exercised production surface, without a Volato runtime dependency.

`pnpm smoke:vite-node` creates a clean full-stack fixture, installs both
adapters through the packed CLI, builds Vite and Node, captures browser,
React, Express and fatal-process failures, and proves map privacy plus fatal
exit semantics.

`pnpm smoke:browser-renderers` runs all 12 Vite 6/7/8 ×
TypeScript/JavaScript Vue 3 and Svelte 5 cells. It exercises framework render,
browser-global and manual capture, private map upload, public-map removal,
privacy, setup convergence and exact causal source resolution.

`pnpm smoke:node-long-lived` consumes the frozen 24-cell matrix and runs the
packed CLI on exact Node 22.23.2/24.19.0 binaries across the three process
shapes, both languages and both module systems. `pnpm smoke:express` runs the
four Express 4.22.2/5.2.1 topology cells with framework-specific async
propagation, application-owned responses, privacy checks and exact source
resolution.

`pnpm smoke:fastify` runs 16 Node 22/24 × TypeScript/JavaScript ×
ESM/CommonJS × same-file/split Fastify 5 cells. `pnpm smoke:nest` runs eight
NestJS 11/12 × Node 22/24 × Express 5/Fastify 5 cells and requires Nest to own
each HTTP event exactly once while preserving the default response lifecycle.
`pnpm smoke:framework-stacks` installs the packed CLI into independent
Vue/Fastify and Svelte/Nest repositories, proves separate frontend/backend
release identities, builds both sides, uploads sanitized maps and captures
without request-value leakage.

`pnpm smoke:node-invocation` runs all 16 exact Node 22.23.2/24.19.0 ×
TypeScript/JavaScript × ESM/CommonJS × generic/Node-HTTP handler cells from the
packed CLI. It proves convergent setup, direct and mapped sources,
cold/warm/concurrent reuse, success/throw/rejection identity, the 2-second
flush bound, minimal HTTP context, privacy, and provider-neutrality. Callback,
synchronous and streaming fixtures must fail before mutation.

## License

MIT — see [LICENSE](./LICENSE).
