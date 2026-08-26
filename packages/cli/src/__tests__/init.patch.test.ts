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
  buildProxySnippet,
  patchNextBuildScript,
  patchEnvLocal,
  patchErrorBoundary,
  patchInstrumentation,
  patchLayout,
  patchNextConfig,
  patchPagesApp,
  patchPagesError,
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

  it("writes the server-only ingest token returned by project setup", () => {
    const out = patchEnvLocal(cwd, DSN, "server-only-token");

    expect(out.status).toBe("created");
    const contents = readFileSync(join(cwd, ".env.local"), "utf8");
    expect(contents).toContain(`NEXT_PUBLIC_VOLATO_DSN=${DSN}`);
    expect(contents).toContain("VOLATO_INGEST_TOKEN=server-only-token");
  });

  it("does not duplicate the key when it already exists", () => {
    writeFileSync(
      join(cwd, ".env.local"),
      `FOO=bar\nNEXT_PUBLIC_VOLATO_DSN=https://existing@volato.dev\n`,
    );

    const out = patchEnvLocal(cwd, DSN);

    expect(out.status).toBe("skipped");
    const contents = readFileSync(join(cwd, ".env.local"), "utf8");
    expect(contents.match(/^NEXT_PUBLIC_VOLATO_DSN=/gm)?.length).toBe(1);
  });

  it("refreshes existing credentials during authenticated project setup", () => {
    writeFileSync(
      join(cwd, ".env.local"),
      [
        "# Keep this comment",
        "FOO=bar",
        "NEXT_PUBLIC_VOLATO_DSN=https://stale@volato.dev",
        "VOLATO_INGEST_TOKEN=stale-token",
        "VOLATO_INGEST_TOKEN=duplicate-stale-token",
        "",
      ].join("\n"),
    );

    const out = patchEnvLocal(cwd, DSN, "fresh-token");

    expect(out.status).toBe("updated");
    expect(out.detail).toBe("refreshed Volato project credentials");
    const contents = readFileSync(join(cwd, ".env.local"), "utf8");
    expect(contents).toContain("# Keep this comment");
    expect(contents).toContain("FOO=bar");
    expect(contents).toContain(`NEXT_PUBLIC_VOLATO_DSN=${DSN}`);
    expect(contents).toContain("VOLATO_INGEST_TOKEN=fresh-token");
    expect(contents).not.toContain("stale@volato.dev");
    expect(contents).not.toContain("stale-token");
    expect(contents.match(/^NEXT_PUBLIC_VOLATO_DSN=/gm)?.length).toBe(1);
    expect(contents.match(/^VOLATO_INGEST_TOKEN=/gm)?.length).toBe(1);
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

describe("patchNextBuildScript", () => {
  it("keeps Turbopack and appends the final browser-map postbuild", () => {
    writeFileSync(
      join(cwd, "package.json"),
      `${JSON.stringify(
        {
          scripts: { dev: "next dev", build: "next build" },
          dependencies: { next: "16.2.12" },
        },
        null,
        2,
      )}\n`,
    );

    const out = patchNextBuildScript(cwd, 16);

    expect(out.status).toBe("updated");
    const pkg = JSON.parse(readFileSync(join(cwd, "package.json"), "utf8")) as {
      scripts: { build: string };
    };
    expect(pkg.scripts.build).toBe("next build && node ./volato/postbuild.cjs");
    expect(pkg.scripts.build).not.toContain("--webpack");
  });
});

describe("patchInstrumentation", () => {
  it("creates a TS instrumentation file when none exists", () => {
    const path = join(cwd, "instrumentation.ts");

    const out = patchInstrumentation(path, "ts");

    expect(out.status).toBe("created");
    expect(readFileSync(path, "utf8")).toContain(
      'export { onRequestError } from "./volato/instrumentation"',
    );
  });

  it("creates an ESM instrumentation.js without requiring package module mode", () => {
    const path = join(cwd, "instrumentation.js");

    const out = patchInstrumentation(path, "js");

    expect(readFileSync(path, "utf8")).toContain(
      'export { onRequestError } from "./volato/instrumentation"',
    );
    expect(readFileSync(path, "utf8")).not.toContain("require(");
    expect(out.status).toBe("created");
    expect(out.detail).toBeUndefined();
  });

  it("skips when the file already wires Volato", () => {
    const path = join(cwd, "instrumentation.ts");
    writeFileSync(
      path,
      'export { onRequestError } from "./volato/instrumentation";\n',
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
      'import { VolatoBootstrap } from "../volato/client";',
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
      'import { VolatoBootstrap } from "../volato/client";\n' + STARTER_LAYOUT,
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

describe("patchPagesApp", () => {
  it("creates a minimal TypeScript custom App without disabling static optimization", () => {
    const path = join(cwd, "pages", "_app.tsx");

    const out = patchPagesApp(path, "../volato/client", "ts");

    expect(out.status).toBe("created");
    const source = readFileSync(path, "utf8");
    expect(source).toContain('import type { AppProps } from "next/app"');
    expect(source).toContain('from "../volato/client"');
    expect(source).toContain("<VolatoBootstrap");
    expect(source).toContain("<Component {...pageProps} />");
    expect(source).not.toContain("getInitialProps");
  });

  it("composes an existing custom App around its single Component render", () => {
    const path = join(cwd, "pages", "_app.tsx");
    mkdirSync(join(cwd, "pages"));
    writeFileSync(
      path,
      `import type { AppProps } from "next/app";
export default function App({ Component, pageProps }: AppProps) {
  return <main><Component {...pageProps} /></main>;
}
`,
    );

    const out = patchPagesApp(path, "../volato/client", "ts");

    expect(out.status).toBe("updated");
    const source = readFileSync(path, "utf8");
    expect(source).toContain("<main><>");
    expect(source).toContain("<VolatoBootstrap");
    expect(source).toContain("<Component {...pageProps} />");
    expect(source).toContain("</></main>");
  });

  it("emits valid JavaScript and refuses an ambiguous custom App", () => {
    const javascriptPath = join(cwd, "pages", "_app.jsx");
    mkdirSync(join(cwd, "pages"));
    writeFileSync(
      javascriptPath,
      "export default function App({ Component, pageProps }) { return <Component {...pageProps} />; }\n",
    );

    expect(
      patchPagesApp(javascriptPath, "../volato/client.jsx", "js").status,
    ).toBe("updated");
    expect(readFileSync(javascriptPath, "utf8")).not.toContain(
      "NEXT_PUBLIC_VOLATO_DSN!",
    );

    const ambiguousPath = join(cwd, "pages", "ambiguous.tsx");
    writeFileSync(
      ambiguousPath,
      "export default function App({ Component, pageProps }) { return Math.random() ? <Component {...pageProps} /> : <Component {...pageProps} />; }\n",
    );
    expect(patchPagesApp(ambiguousPath, "../volato/client", "ts").status).toBe(
      "manual",
    );
  });
});

describe("patchPagesError", () => {
  it("creates a wrapper around Next's native error component", () => {
    const path = join(cwd, "pages", "_error.tsx");

    const out = patchPagesError(path, "../volato/pages-error");

    expect(out.status).toBe("created");
    const source = readFileSync(path, "utf8");
    expect(source).toContain('import NextError from "next/error"');
    expect(source).toContain('from "../volato/pages-error"');
    expect(source).toContain("withVolatoPagesError(NextError)");
  });

  it("wraps and preserves an existing custom error export", () => {
    const path = join(cwd, "pages", "_error.tsx");
    mkdirSync(join(cwd, "pages"));
    writeFileSync(
      path,
      `function CustomError({ statusCode }) { return <p>{statusCode}</p>; }
CustomError.getInitialProps = ({ res }) => ({ statusCode: res?.statusCode ?? 500 });
export default CustomError;
`,
    );

    const out = patchPagesError(path, "../volato/pages-error");

    expect(out.status).toBe("updated");
    const source = readFileSync(path, "utf8");
    expect(source).toContain("CustomError.getInitialProps");
    expect(source).toContain(
      "export default withVolatoPagesError(CustomError)",
    );
    expect(patchPagesError(path, "../volato/pages-error").status).toBe(
      "skipped",
    );
  });
});

describe("buildMiddlewareSnippet", () => {
  it("returns a wrapMiddleware snippet referencing generated source", () => {
    const snippet = buildMiddlewareSnippet();
    expect(snippet).toContain(
      'import { wrapMiddleware } from "./volato/middleware"',
    );
    expect(snippet).toContain("wrapMiddleware(");
  });

  it("reads the DSN from NEXT_PUBLIC_VOLATO_DSN so it is reachable from the Edge runtime", () => {
    const snippet = buildMiddlewareSnippet();
    expect(snippet).toContain("process.env.NEXT_PUBLIC_VOLATO_DSN");
    expect(snippet).toContain("process.env.NEXT_PUBLIC_VOLATO_RELEASE");
    expect(snippet).toContain("process.env.NEXT_PUBLIC_VOLATO_COMMIT_SHA");
    expect(snippet).toContain("environment: process.env.NODE_ENV");
    expect(snippet).not.toMatch(/process\.env\.VOLATO_DSN(?!_)/);
  });

  it("emits valid JavaScript when the host middleware is JavaScript", () => {
    const snippet = buildMiddlewareSnippet("./volato/middleware.js", "js");

    expect(snippet).toContain('from "./volato/middleware.js"');
    expect(snippet).toContain("dsn: process.env.NEXT_PUBLIC_VOLATO_DSN,");
    expect(snippet).not.toContain("NEXT_PUBLIC_VOLATO_DSN!");
  });
});

describe("buildProxySnippet", () => {
  it("uses the Node-runtime proxy wrapper without Edge-only configuration", () => {
    const snippet = buildProxySnippet();

    expect(snippet).toContain('import { wrapProxy } from "./volato/server"');
    expect(snippet).toContain("export const proxy = wrapProxy(");
    expect(snippet).not.toContain("process.env");
    expect(snippet).not.toContain("wrapMiddleware");
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
    expect(next).toContain('import { withVolato } from "./volato/withVolato"');
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

  it("wraps a multi-line ternary export as a whole (no mid-expression truncation)", () => {
    const path = join(cwd, "next.config.ts");
    writeFileSync(
      path,
      "const prod = { reactStrictMode: true };\nconst dev = { reactStrictMode: false };\nexport default process.env.NODE_ENV === 'production'\n  ? prod\n  : dev;\n",
    );
    const out = patchNextConfig(path);
    expect(out.status).toBe("updated");
    const next = readFileSync(path, "utf8");
    // The entire ternary is wrapped, not just the boolean condition.
    expect(next).toContain(
      "export default withVolato(process.env.NODE_ENV === 'production'",
    );
    expect(next).toContain("? prod");
    expect(next).toContain(": dev)");
    // The corruption bug wrapped only the condition, leaving a dangling
    // `? prod : dev` that discards the wrap entirely.
    expect(next).not.toContain(
      "withVolato(process.env.NODE_ENV === 'production')",
    );
  });

  it("wraps a multi-line builder chain as a whole (no crash-inducing truncation)", () => {
    const path = join(cwd, "next.config.ts");
    writeFileSync(
      path,
      "const base = { reactStrictMode: true };\nexport default base\n  .with({ a: 1 })\n  .build();\n",
    );
    const out = patchNextConfig(path);
    expect(out.status).toBe("updated");
    const next = readFileSync(path, "utf8");
    // The full chain lives inside withVolato(...).
    expect(next).toContain("export default withVolato(base");
    expect(next).toContain(".with({ a: 1 })");
    expect(next).toContain(".build())");
    // The corruption bug produced `withVolato(base).with(...).build()`,
    // which throws at config load (.with is not a function).
    expect(next).not.toContain("withVolato(base)");
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

describe("patchErrorBoundary", () => {
  it("creates an App Router error boundary that reports render errors", () => {
    const path = join(cwd, "app", "error.tsx");
    const out = patchErrorBoundary(path, "../volato/error-boundary");

    expect(out.status).toBe("created");
    const body = readFileSync(path, "utf8");
    expect(body).toContain('"use client"');
    expect(body).toContain(
      'import { captureFromErrorBoundary } from "../volato/error-boundary"',
    );
    expect(body).toContain("captureFromErrorBoundary(error)");
    expect(body).toContain("reset()");
  });

  it("is idempotent when Volato is already wired", () => {
    const path = join(cwd, "app", "error.tsx");
    patchErrorBoundary(path, "../volato/error-boundary");

    expect(patchErrorBoundary(path, "../volato/error-boundary").status).toBe(
      "skipped",
    );
  });

  it("leaves an existing application boundary for manual composition", () => {
    const path = join(cwd, "app", "error.tsx");
    mkdirSync(join(cwd, "app"), { recursive: true });
    writeFileSync(
      path,
      '"use client";\nexport default function Error() { return null; }\n',
    );

    const out = patchErrorBoundary(path, "../volato/error-boundary");

    expect(out.status).toBe("manual");
    expect(readFileSync(path, "utf8")).not.toContain(
      "captureFromErrorBoundary",
    );
  });
});
