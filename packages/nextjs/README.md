# @volatodev/nextjs

Next.js error-tracking SDK for [Volato](https://volato.dev) — agent-native error tracking.

Captures errors across every Next.js runtime (Node, Edge, browser) and streams them to your Volato project, where your AI agent reads them back with full fix context. Requires **Next.js 15+** (App Router).

> **Privacy:** your source code never leaves your machine. Uploaded sourcemaps have `sourcesContent` stripped client-side; the agent reads the snippet from your own repo. Request bodies, cookies, and auth headers are never captured.

## Quickstart

```bash
npm install @volatodev/nextjs
npm install -g @volatodev/cli
volato init                 # wires the SDK into your app
volato login <token>        # workspace token from https://app.volato.dev
```

`volato init` writes the DSN, creates `instrumentation.ts`, mounts the browser bootstrap, and sets up the tunnel route. If you'd rather wire it by hand, follow the steps below.

## Manual setup

**1. Set your DSN** in `.env.local`:

```bash
NEXT_PUBLIC_VOLATO_DSN="https://<public_key>@api.volato.dev/<project_id>"
```

`NEXT_PUBLIC_*` is readable on the server too, so this single var covers every runtime.

**2. Server, RSC & route-handler capture** — re-export the hook from `instrumentation.ts`:

```ts
export { onRequestError } from "@volatodev/nextjs/instrumentation";
```

**3. Browser capture** — mount the bootstrap in your root layout:

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

**4. Render-phase errors** — capture from the App Router's `app/error.tsx` boundary:

```tsx
"use client";

import { useEffect } from "react";
import { captureFromErrorBoundary } from "@volatodev/nextjs/error-boundary";

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { captureFromErrorBoundary(error); }, [error]);
  return <button onClick={reset}>Try again</button>;
}
```

**5. Edge middleware** (optional):

```ts
import { wrapMiddleware } from "@volatodev/nextjs/middleware";

export default wrapMiddleware(async (req) => {
  // your existing middleware logic
}, { dsn: process.env.NEXT_PUBLIC_VOLATO_DSN! });
```

**6. Same-origin tunnel** (optional, sidesteps adblockers) — `volato init` creates this at `app/monitoring/route.ts`:

```ts
import { createTunnelHandler } from "@volatodev/nextjs/server";

export const POST = createTunnelHandler();
```

## Sourcemap upload (readable stack traces)

Wrap your `next.config` so the build uploads `sourcesContent`-stripped maps:

```ts
import { withVolato } from "@volatodev/nextjs";

export default withVolato({
  // your Next.js config
});
```

## Breadcrumbs

Once `VolatoBootstrap` is mounted, opt into automatic context (silent until called):

```tsx
"use client";
import { useEffect } from "react";
import { instrumentFetch, instrumentNavigation, instrumentConsole } from "@volatodev/nextjs/client";

useEffect(() => {
  instrumentFetch();        // failed fetches
  instrumentNavigation();   // pushState / popstate
  instrumentConsole();      // console.error (filters React noise by default)
}, []);
```

Push your own anytime:

```tsx
import { addBreadcrumb } from "@volatodev/nextjs/client";
addBreadcrumb({ category: "auth", message: "user signed in", data: { userId } });
```

## Configuration

Every runtime entry accepts a `VolatoConfig`:

```ts
{
  dsn: string;
  environment?: string;       // "development" no-ops; defaults to NODE_ENV
  release?: string;           // git SHA / semver; auto-detected from VOLATO_RELEASE
  beforeSend?: (event) => event | null;   // mutate or drop events (PII scrubbing)
  ignoreErrors?: (string | RegExp)[];     // silence known noise by type/message
  tunnel?: string | false;    // same-origin tunnel path; defaults to "/monitoring"
}
```

`beforeSend` runs once per event right before send. Throwing inside it never crashes your app — the event is sent through unchanged.

## License

MIT © Wrenchy SASU
