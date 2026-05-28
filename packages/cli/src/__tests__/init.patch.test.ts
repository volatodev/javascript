import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildMiddlewareSnippet,
  patchEnvLocal,
  patchInstrumentation,
  patchLayout,
  patchNextConfig,
  patchTunnelRoute,
} from "../commands/init/patch";

let cwd: string;

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), "volato-patch-"));
});

afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
});

const DSN = "https://abc123@volato.dev";

describe("patchEnvLocal", () => {
  it("creates `.env.local` with the public DSN when missing", () => {
    const out = patchEnvLocal(cwd, DSN);

    expect(out.status).toBe("created");
    const contents = readFileSync(join(cwd, ".env.local"), "utf8");
    expect(contents).toContain(`NEXT_PUBLIC_VOLATO_DSN=${DSN}`);
    // The legacy server-only twin is intentionally gone: NEXT_PUBLIC_* is
    // readable on the server too, so a second VOLATO_DSN would be dead
    // surface area.
    expect(contents).not.toMatch(/^VOLATO_DSN=/m);
  });

  it("does not duplicate the key when it already exists", () => {
    writeFileSync(
      join(cwd, ".env.local"),
      `FOO=bar\nNEXT_PUBLIC_VOLATO_DSN=https://existing@volato.dev\n`,
    );

    const out = patchEnvLocal(cwd, DSN);

    expect(out.status).toBe("skipped");
    const contents = readFileSync(join(cwd, ".env.local"), "utf8");
    expect(
      contents.match(/^NEXT_PUBLIC_VOLATO_DSN=/gm)?.length,
    ).toBe(1);
  });

  it("preserves missing trailing newlines on append", () => {
    writeFileSync(join(cwd, ".env.local"), "FOO=bar");

    patchEnvLocal(cwd, DSN);

    const contents = readFileSync(join(cwd, ".env.local"), "utf8");
    expect(contents.split("\n").filter(Boolean)).toEqual([
      "FOO=bar",
      `NEXT_PUBLIC_VOLATO_DSN=${DSN}`,
    ]);
  });
});

describe("patchInstrumentation", () => {
  it("creates a TS instrumentation file when none exists", () => {
    const path = join(cwd, "instrumentation.ts");

    const out = patchInstrumentation(path, "ts");

    expect(out.status).toBe("created");
    expect(readFileSync(path, "utf8")).toContain(
      'export { onRequestError } from "@volatodev/nextjs/instrumentation"',
    );
  });

  it("creates an ESM instrumentation.js with a type:module reminder", () => {
    const path = join(cwd, "instrumentation.js");

    const out = patchInstrumentation(path, "js");

    expect(readFileSync(path, "utf8")).toContain(
      'export { onRequestError } from "@volatodev/nextjs/instrumentation"',
    );
    expect(readFileSync(path, "utf8")).not.toContain("require(");
    expect(out.detail).toMatch(/type.*module/);
  });

  it("skips when the file already wires Volato", () => {
    const path = join(cwd, "instrumentation.ts");
    writeFileSync(
      path,
      'export { onRequestError } from "@volatodev/nextjs/instrumentation";\n',
    );

    const out = patchInstrumentation(path, "ts");

    expect(out.status).toBe("skipped");
  });

  it("returns `manual` when an unrelated instrumentation file exists", () => {
    const path = join(cwd, "instrumentation.ts");
    writeFileSync(path, "export function register() { /* opentelemetry */ }\n");

    const out = patchInstrumentation(path, "ts");

    expect(out.status).toBe("manual");
    expect(readFileSync(path, "utf8")).toContain("opentelemetry");
  });
});

describe("patchLayout", () => {
  const STARTER_LAYOUT = `import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = { title: "App" };

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
`;

  function writeLayout(contents: string): string {
    const path = join(cwd, "app", "layout.tsx");
    mkdirSync(join(cwd, "app"));
    writeFileSync(path, contents);
    return path;
  }

  it("inserts <VolatoBootstrap /> as a sibling of {children} (no wrapper)", () => {
    const path = writeLayout(STARTER_LAYOUT);

    const out = patchLayout(path);

    expect(out.status).toBe("updated");
    const contents = readFileSync(path, "utf8");
    expect(contents).toContain(
      'import { VolatoBootstrap } from "@volatodev/nextjs/client";',
    );
    expect(contents).toContain("<VolatoBootstrap");
    // No wrapper: VolatoErrorBoundary must NOT appear (it's a client
    // class component and would break the default-server layout).
    expect(contents).not.toContain("VolatoErrorBoundary");
    expect(contents).toContain('import type { Metadata } from "next";');
    expect(contents).toContain('import "./globals.css";');
  });

  it("skips a layout that already references Volato", () => {
    const path = writeLayout(
      'import { VolatoBootstrap } from "@volatodev/nextjs/client";\n' +
        STARTER_LAYOUT,
    );

    const out = patchLayout(path);

    expect(out.status).toBe("skipped");
  });

  it("returns `manual` when no `{children}` is found", () => {
    const path = writeLayout(
      `export default function Layout() { return <html><body /></html>; }\n`,
    );

    const out = patchLayout(path);

    expect(out.status).toBe("manual");
  });

  it("returns `manual` when multiple `{children}` are found", () => {
    const path = writeLayout(
      `export default function Layout({ children }: { children: any }) {
  return process.env.A ? <div>{children}</div> : <main>{children}</main>;
}
`,
    );

    const out = patchLayout(path);

    expect(out.status).toBe("manual");
  });
});

describe("buildMiddlewareSnippet", () => {
  it("returns a wrapMiddleware snippet referencing the SDK", () => {
    const snippet = buildMiddlewareSnippet();
    expect(snippet).toContain(
      'import { wrapMiddleware } from "@volatodev/nextjs/middleware"',
    );
    expect(snippet).toContain("wrapMiddleware(");
  });

  it("reads the DSN from NEXT_PUBLIC_VOLATO_DSN so it is reachable from the Edge runtime", () => {
    const snippet = buildMiddlewareSnippet();
    expect(snippet).toContain("process.env.NEXT_PUBLIC_VOLATO_DSN");
    expect(snippet).not.toMatch(/process\.env\.VOLATO_DSN(?!_)/);
  });
});

describe("patchNextConfig", () => {
  it("returns manual when next.config is missing", () => {
    const out = patchNextConfig(null);
    expect(out.status).toBe("manual");
  });

  it("wraps an `export default { ... }` config and prepends the import", () => {
    const path = join(cwd, "next.config.ts");
    writeFileSync(path, "export default { reactStrictMode: true };\n");

    const out = patchNextConfig(path);
    expect(out.status).toBe("updated");
    const next = readFileSync(path, "utf8");
    expect(next).toContain('import { withVolato } from "@volatodev/nextjs"');
    expect(next).toContain(
      "export default withVolato({ reactStrictMode: true })",
    );
  });

  it("is idempotent — second call is a no-op skip", () => {
    const path = join(cwd, "next.config.ts");
    writeFileSync(path, "export default { x: 1 };\n");
    patchNextConfig(path);
    const out = patchNextConfig(path);
    expect(out.status).toBe("skipped");
  });

  it("returns manual on `module.exports = …` shape", () => {
    const path = join(cwd, "next.config.js");
    writeFileSync(path, "module.exports = { x: 1 };\n");
    const out = patchNextConfig(path);
    expect(out.status).toBe("manual");
  });

  it("preserves an adjacent `export const runtime` after the default export", () => {
    const path = join(cwd, "next.config.ts");
    writeFileSync(
      path,
      "export default { reactStrictMode: true };\nexport const runtime = 'nodejs';\n",
    );
    const out = patchNextConfig(path);
    expect(out.status).toBe("updated");
    const next = readFileSync(path, "utf8");
    expect(next).toContain(
      "export default withVolato({ reactStrictMode: true })",
    );
    // The runtime export must survive verbatim.
    expect(next).toContain("export const runtime = 'nodejs';");
    // ... and must NOT have been swallowed into the withVolato call.
    expect(next).not.toContain("withVolato({ reactStrictMode: true };");
  });

  it("captures balanced parens / braces inside the export expression", () => {
    const path = join(cwd, "next.config.ts");
    writeFileSync(
      path,
      "import withMDX from '@next/mdx';\nexport default withMDX({ extension: /\\.mdx?$/ })({ reactStrictMode: true });\n",
    );
    const out = patchNextConfig(path);
    expect(out.status).toBe("updated");
    const next = readFileSync(path, "utf8");
    // The full call expression — including both invocations — is wrapped.
    expect(next).toContain(
      "export default withVolato(withMDX({ extension: /\\.mdx?$/ })({ reactStrictMode: true }))",
    );
  });

  it("ignores `export default` inside a string literal", () => {
    const path = join(cwd, "next.config.ts");
    writeFileSync(
      path,
      "const docs = `the README says: export default {};`;\nexport default { reactStrictMode: true };\n",
    );
    const out = patchNextConfig(path);
    expect(out.status).toBe("updated");
    const next = readFileSync(path, "utf8");
    // The string literal is untouched; only the real export was wrapped.
    expect(next).toContain("`the README says: export default {};`");
    expect(next).toContain(
      "export default withVolato({ reactStrictMode: true })",
    );
  });
});

describe("patchTunnelRoute", () => {
  it("creates app/monitoring/route.ts with createTunnelHandler", () => {
    const path = join(cwd, "app", "monitoring", "route.ts");
    const out = patchTunnelRoute(path, "ts");
    expect(out.status).toBe("created");
    const body = readFileSync(path, "utf8");
    expect(body).toContain('from "@volatodev/nextjs/server"');
    expect(body).toContain("export const POST = createTunnelHandler()");
  });

  it("creates the JS variant with require(...) when language is js", () => {
    const path = join(cwd, "app", "monitoring", "route.js");
    patchTunnelRoute(path, "js");
    const body = readFileSync(path, "utf8");
    expect(body).toContain('require("@volatodev/nextjs/server")');
    expect(body).toContain("exports.POST = createTunnelHandler()");
  });

  it("is idempotent — second call skips", () => {
    const path = join(cwd, "app", "monitoring", "route.ts");
    patchTunnelRoute(path, "ts");
    const out = patchTunnelRoute(path, "ts");
    expect(out.status).toBe("skipped");
  });

  it("returns manual when the file exists but lacks the marker", () => {
    const path = join(cwd, "app", "monitoring", "route.ts");
    mkdirSync(join(cwd, "app", "monitoring"), { recursive: true });
    writeFileSync(path, "export const POST = () => new Response();\n");
    const out = patchTunnelRoute(path, "ts");
    expect(out.status).toBe("manual");
  });
});
