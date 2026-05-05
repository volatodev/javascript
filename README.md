# Volato JavaScript SDKs

Official JavaScript and TypeScript SDKs for [Volato](https://volato.dev) — MCP-native error tracking for modern web apps.

## Packages

| Package | Description |
| --- | --- |
| [`@volatodev/core`](./packages/core) | Wire format schemas and DSN parser, shared between SDKs and ingestion. |
| [`@volatodev/nextjs`](./packages/nextjs) | Next.js error tracking SDK — captures errors across all Next.js runtimes. |

## Quickstart (Next.js)

```bash
pnpm add @volatodev/nextjs
npx volato init
```

Set your DSN in `.env.local`:

```bash
NEXT_PUBLIC_VOLATO_DSN="https://<public_key>@ingest.volato.dev/<project_id>"
VOLATO_DSN="https://<public_key>@ingest.volato.dev/<project_id>"
```

Mount the browser bootstrap inside your root layout:

```tsx
import { VolatoBootstrap } from "@volatodev/nextjs/client";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html>
      <body>
        <VolatoBootstrap dsn={process.env.NEXT_PUBLIC_VOLATO_DSN!} />
        {children}
      </body>
    </html>
  );
}
```

Catch render-phase errors via the App Router's `app/error.tsx` file-system boundary:

```tsx
"use client";

import { useEffect } from "react";
import { captureFromErrorBoundary } from "@volatodev/nextjs/error-boundary";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    captureFromErrorBoundary(error);
  }, [error]);

  return <button onClick={reset}>Try again</button>;
}
```

## MCP integration

Volato exposes an MCP server so any LLM-powered IDE (Claude Code, Cursor, etc.) can query your errors directly:

```json
{
  "mcpServers": {
    "volato": {
      "url": "https://api.volato.dev/v1/mcp",
      "headers": {
        "Authorization": "Bearer ${VOLATO_MCP_TOKEN}"
      }
    }
  }
}
```

## Development

This is a pnpm + Turborepo monorepo.

```bash
pnpm install
pnpm build
pnpm test
```

## License

MIT — see [LICENSE](./LICENSE).
