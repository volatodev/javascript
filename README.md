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

## Automatic context (breadcrumbs)

Once `VolatoBootstrap` is mounted, the SDK can record a trail of what happened *before* an error fires. The MCP server returns those breadcrumbs alongside the stack so the agent reads the trigger sequence, not just the crash.

Three opt-in instrumentations are shipped — they are silent until you call them:

```tsx
"use client";

import { useEffect } from "react";
import {
  instrumentConsole,
  instrumentFetch,
  instrumentNavigation,
} from "@volatodev/nextjs/client";

export function VolatoInstrumentations() {
  useEffect(() => {
    instrumentFetch();        // failed fetches → breadcrumb (fetch, status, duration)
    instrumentNavigation();   // pushState / popstate → breadcrumb (from, to)
    instrumentConsole();      // console.error → breadcrumb (default ignore list filters React noise)
  }, []);
  return null;
}
```

Each call is idempotent (safe under StrictMode / HMR). To filter or extend behaviour:

```tsx
instrumentFetch({ captureStatusFrom: 400 });             // also surface 4xx
instrumentConsole({ levels: ["error", "warn"] });        // include warns
instrumentConsole({ ignore: [/Warning: deprecated/] });  // override ignore patterns
```

You can also push your own breadcrumbs at any time:

```tsx
import { addBreadcrumb } from "@volatodev/nextjs/client";

addBreadcrumb({ category: "auth", message: "user signed in", data: { userId } });
```

The MCP renderer caps the rendered timeline at the 12 most-recent breadcrumbs (newest first), so noisy categories don't crowd out the relevant ones.

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
