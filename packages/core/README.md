# @volatodev/core

Wire-format schemas and DSN parser for [Volato](https://volato.dev) — agent-native error tracking.

This is the contract layer shared between the Volato SDKs and the ingestion backend: the zod schemas that define the event payload, the DSN parser, and the source-map key derivation. It is byte-identical on both ends of the pipe, so an SDK never sends a shape the ingest can't validate.

> Most people don't install this directly. It comes in as a dependency of [`@volatodev/nextjs`](https://www.npmjs.com/package/@volatodev/nextjs). Install it on its own only if you're building a custom integration against the Volato wire format.

## Install

```bash
npm install @volatodev/core
```

## What's in it

- **`ErrorEventSchema` / `ErrorEvent`** — the event payload zod schema and its inferred type. Request bodies are never part of the schema by design.
- **`parseDSN(dsn)` / `ParsedDSN`** — parse a Volato DSN (`https://<public_key>@<host>/<project_id>`) into its parts; throws `InvalidDSNError` on a malformed value.
- **`dsnToIngestUrl(dsn)`** — derive the ingest endpoint from a DSN.
- **source-map key helpers** — map a runtime stack frame to the key under which its sourcemap is stored.

```ts
import { parseDSN, ErrorEventSchema } from "@volatodev/core";

const dsn = parseDSN("https://pk_live_xxx@ingest.volato.dev/proj_123");
const event = ErrorEventSchema.parse(payload);
```

## License

MIT © Wrenchy SASU
