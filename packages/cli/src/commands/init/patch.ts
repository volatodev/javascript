/**
 * The actual file mutations `volato init` performs. Lives apart
 * from `init.ts` (the orchestrator) so each patch is a small,
 * focused, idempotent function:
 *
 *   - `patchEnvLocal`            append the two DSN env vars
 *   - `patchNextBuildScript`     preserve the application's selected bundler;
 *                                Next.js 16 uses Volato's native compiler hook
 *   - `patchInstrumentation`     create `instrumentation.ts`
 *   - `patchLayout`              insert `<VolatoBootstrap>` next
 *                                to `{children}` in the root
 *                                layout
 *   - `patchNextConfig`          wrap `export default ...` with
 *                                `withVolato(...)` via a
 *                                bracket-counting walker (the
 *                                regex version was greedy and
 *                                ate adjacent `export const`
 *                                lines — the walker stops at
 *                                the right statement boundary)
 *   - `patchErrorBoundary`       create `app/error.tsx`
 *   - `buildMiddlewareSnippet`   the only one that doesn't write
 *                                — middleware shapes vary too
 *                                much for a regex patch to be
 *                                safe, so we hand the user a
 *                                snippet to paste themselves.
 *
 * Every patch returns a `PatchOutcome` with one of four
 * statuses (`created` / `updated` / `skipped` / `manual`) so
 * the orchestrator can render the final report without re-
 * reading the file. Re-running `volato init` is safe.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export type PatchStatus = "created" | "updated" | "skipped" | "manual";

export type PatchOutcome = {
  path: string;
  status: PatchStatus;
  detail?: string;
};

function ensureDir(path: string): void {
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function readIfExists(path: string): string | null {
  if (!existsSync(path)) return null;
  return readFileSync(path, "utf8");
}

/**
 * Add the Volato DSN to `.env.local`, preserving unrelated content.
 * Idempotent: a key that already exists is never duplicated. Authenticated
 * project setup is authoritative, so it refreshes stale project credentials
 * after key rotation; the manual DSN fallback leaves existing values alone.
 *
 * Single source of truth: `NEXT_PUBLIC_VOLATO_DSN`. Next.js exposes
 * `NEXT_PUBLIC_*` to server-side code too, so we don't need a separate
 * `VOLATO_DSN` server twin. When authenticated project setup returns the
 * server-only sourcemap token, it is written alongside the DSN.
 */
export function patchEnvLocal(
  cwd: string,
  dsn: string,
  ingestToken?: string,
): PatchOutcome {
  return patchEnvValues(
    cwd,
    [
      { key: "NEXT_PUBLIC_VOLATO_DSN", value: dsn },
      ...(ingestToken
        ? [{ key: "VOLATO_INGEST_TOKEN", value: ingestToken }]
        : []),
    ],
    ingestToken !== undefined,
  );
}

export function patchEnvValues(
  cwd: string,
  keys: Array<{ key: string; value: string }>,
  authoritative = false,
): PatchOutcome {
  const path = `${cwd}/.env.local`;
  const existing = readIfExists(path) ?? "";
  const projectSetup = authoritative;
  const values = new Map(keys.map(({ key, value }) => [key, value]));
  const present = new Set<string>();
  let refreshed = false;

  const lines = existing.split("\n").filter((line) => {
    const match = line.match(/^([A-Z0-9_]+)\s*=/);
    const key = match?.[1];
    if (!projectSetup || !key || !values.has(key)) return true;

    if (present.has(key)) {
      refreshed = true;
      return false;
    }

    present.add(key);
    const replacement = `${key}=${values.get(key)}`;
    if (line !== replacement) refreshed = true;
    return true;
  });

  if (projectSetup && refreshed) {
    const seen = new Set<string>();
    const refreshedLines = lines.map((line) => {
      const key = line.match(/^([A-Z0-9_]+)\s*=/)?.[1];
      if (!key || !values.has(key) || seen.has(key)) return line;
      seen.add(key);
      return `${key}=${values.get(key)}`;
    });
    const missing = keys.filter(({ key }) => !seen.has(key));
    const normalized = refreshedLines.join("\n");
    const prefix =
      missing.length === 0 ||
      normalized.length === 0 ||
      normalized.endsWith("\n")
        ? ""
        : "\n";
    const block = missing.map(({ key, value }) => `${key}=${value}`).join("\n");
    const suffix = missing.length > 0 ? "\n" : "";
    writeFileSync(path, `${normalized}${prefix}${block}${suffix}`, "utf8");
    return {
      path,
      status: existing.length === 0 ? "created" : "updated",
      detail: "refreshed Volato project credentials",
    };
  }

  if (!projectSetup) {
    for (const line of lines) {
      const key = line.match(/^([A-Z0-9_]+)\s*=/)?.[1];
      if (key) present.add(key);
    }
  }

  const toAppend = keys.filter((k) => !present.has(k.key));
  if (toAppend.length === 0) {
    return {
      path,
      status: "skipped",
      detail: "Volato env vars already present",
    };
  }

  const prefix = existing.length === 0 || existing.endsWith("\n") ? "" : "\n";
  const block = toAppend.map((k) => `${k.key}=${k.value}`).join("\n");
  const next = `${existing}${prefix}${block}\n`;
  writeFileSync(path, next, "utf8");

  return {
    path,
    status: existing.length === 0 ? "created" : "updated",
    detail: `wrote ${toAppend.map((k) => k.key).join(", ")}`,
  };
}

/**
 * Preserve the application's build command. Next.js 15 reaches the sourcemap
 * uploader through Webpack's `afterEmit`; Next.js 16 reaches the same uploader
 * through `compiler.runAfterProductionCompile`, which is bundler-neutral.
 */
export function patchNextBuildScript(
  cwd: string,
  nextMajor: number,
  postbuildPath = "./volato/postbuild.cjs",
): PatchOutcome {
  const path = `${cwd}/package.json`;
  if (nextMajor < 16) {
    return {
      path,
      status: "skipped",
      detail: "Next.js 15 emits final maps during Webpack compilation",
    };
  }

  const raw = readIfExists(path);
  if (!raw) {
    return { path, status: "manual", detail: "package.json is missing" };
  }
  let pkg: Record<string, unknown>;
  try {
    pkg = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return { path, status: "manual", detail: "package.json is invalid JSON" };
  }
  const scripts =
    pkg.scripts && typeof pkg.scripts === "object"
      ? (pkg.scripts as Record<string, unknown>)
      : null;
  const build = scripts?.build;
  if (typeof build !== "string") {
    return {
      path,
      status: "manual",
      detail: `run \`node ${postbuildPath}\` after the production Next.js build`,
    };
  }
  if (build.includes(postbuildPath)) {
    return {
      path,
      status: "skipped",
      detail: "Next.js 16 browser-map postbuild already runs",
    };
  }
  if (!/^next\s+build(?:\s+[^;&|]+)?$/.test(build.trim())) {
    return {
      path,
      status: "manual",
      detail: `custom build command — run \`node ${postbuildPath}\` only after Next.js completes`,
    };
  }

  scripts!.build = `${build.trim()} && node ${postbuildPath}`;
  writeFileSync(path, `${JSON.stringify(pkg, null, 2)}\n`, "utf8");
  return {
    path,
    status: "updated",
    detail: "kept the selected bundler and added the final browser-map upload",
  };
}

/**
 * Create `instrumentation.ts` (or `.js`) re-exporting the generated hook.
 *
 * Both .ts and .js variants emit ESM `export { onRequestError }`; Next.js
 * compiles the instrumentation convention as application source regardless of
 * the package's Node module mode.
 *
 * If the file already exists with a Volato marker → skip; if it
 * exists without one → `manual` so the orchestrator warns the user.
 */
export function patchInstrumentation(
  path: string,
  language: "ts" | "js",
  modulePath = "./volato/instrumentation",
): PatchOutcome {
  const existing = readIfExists(path);
  if (existing && existing.includes(modulePath)) {
    return {
      path,
      status: "skipped",
      detail: "instrumentation already wires the generated Volato hook",
    };
  }
  if (existing) {
    return {
      path,
      status: "manual",
      detail: `instrumentation file exists — re-export onRequestError from "${modulePath}" manually`,
    };
  }

  ensureDir(path);
  const body = `export { onRequestError } from "${modulePath}";\n`;
  writeFileSync(path, body, "utf8");
  return { path, status: "created" };
}

/**
 * Patch `app/layout.tsx`:
 *
 *   1. Add one import: VolatoBootstrap.
 *   2. Insert `<VolatoBootstrap dsn={...} />` next to `{children}`.
 *
 * `<VolatoBootstrap>` is a client component that renders nothing (it
 * just mounts browser capture). Next.js allows client components to
 * render inside server components, so this works whether or not the
 * layout is `"use client"`. The render-phase error boundary belongs in
 * `app/error.tsx` / `app/global-error.tsx` — App Router's file-system
 * mechanism — not wrapped around the layout: that path is incompatible
 * with server layouts and competes with Next's own error handling.
 *
 * Falls back to `manual` when the layout shape is unusual.
 */
export function patchLayout(
  path: string,
  modulePath = "../volato/client",
  language: "ts" | "js" = path.endsWith(".jsx") ? "js" : "ts",
): PatchOutcome {
  const original = readIfExists(path);
  if (original === null) {
    return {
      path,
      status: "manual",
      detail: "layout file not found — copy the snippet from the docs",
    };
  }
  if (original.includes(modulePath)) {
    return {
      path,
      status: "skipped",
      detail: "layout already imports Volato",
    };
  }

  const childrenOccurrences = original.split("{children}").length - 1;
  if (childrenOccurrences !== 1) {
    return {
      path,
      status: "manual",
      detail:
        childrenOccurrences === 0
          ? "no `{children}` found in layout"
          : "multiple `{children}` usages — insert <VolatoBootstrap /> manually",
    };
  }

  const importBlock = `import { VolatoBootstrap } from "${modulePath}";\n`;
  // Sibling, not wrapper — keeps the patch compatible with server
  // layouts (the default for app/layout.tsx in Next 15).
  const dsn =
    language === "ts"
      ? "process.env.NEXT_PUBLIC_VOLATO_DSN!"
      : "process.env.NEXT_PUBLIC_VOLATO_DSN";
  const insertion = `<VolatoBootstrap dsn={${dsn}} />\n        {children}`;

  const withInsertion = original.replace("{children}", insertion);
  const withImports = insertAfterLastImport(withInsertion, importBlock);

  writeFileSync(path, withImports, "utf8");
  return { path, status: "updated" };
}

/**
 * Insert `block` after the last top-level `import …` line, or at the very top
 * if no imports exist. Preserves the existing newline shape.
 */
function insertAfterLastImport(source: string, block: string): string {
  const importRegex = /^import .+;?\s*$/gm;
  let lastEnd = 0;
  let match: RegExpExecArray | null;
  while ((match = importRegex.exec(source)) !== null) {
    lastEnd = match.index + match[0].length;
  }
  if (lastEnd === 0) {
    return `${block}\n${source}`;
  }
  const before = source.slice(0, lastEnd);
  const after = source.slice(lastEnd);
  const sep = after.startsWith("\n") ? "\n" : "\n\n";
  return `${before}\n${block}${sep}${after.replace(/^\n+/, "")}`;
}

/**
 * Mount browser capture in the Pages Router's custom App. Creating `_app`
 * deliberately avoids `getInitialProps`, so static optimization is preserved.
 * Existing Apps are changed only when exactly one self-closing `<Component />`
 * render can be identified; every other shape remains a manual composition.
 */
export function patchPagesApp(
  path: string,
  modulePath = "../volato/client",
  language: "ts" | "js" = path.endsWith(".tsx") ? "ts" : "js",
): PatchOutcome {
  const existing = readIfExists(path);
  const dsn =
    language === "ts"
      ? "process.env.NEXT_PUBLIC_VOLATO_DSN!"
      : "process.env.NEXT_PUBLIC_VOLATO_DSN";
  const bootstrap = `<VolatoBootstrap dsn={${dsn}} />`;
  const importLine = `import { VolatoBootstrap } from "${modulePath}";\n`;

  if (existing === null) {
    ensureDir(path);
    const typeImport =
      language === "ts" ? 'import type { AppProps } from "next/app";\n' : "";
    const props =
      language === "ts"
        ? "{ Component, pageProps }: AppProps"
        : "{ Component, pageProps }";
    writeFileSync(
      path,
      `${typeImport}${importLine}\nexport default function App(${props}) {\n  return (\n    <>\n      ${bootstrap}\n      <Component {...pageProps} />\n    </>\n  );\n}\n`,
      "utf8",
    );
    return { path, status: "created" };
  }
  if (existing.includes("VolatoBootstrap") || existing.includes(modulePath)) {
    return {
      path,
      status: "skipped",
      detail: "custom App already mounts Volato browser capture",
    };
  }

  const componentRenders = existing.match(/<Component\b[\s\S]*?\/>/g) ?? [];
  if (componentRenders.length !== 1) {
    return {
      path,
      status: "manual",
      detail:
        "custom App has no single `<Component />` render — mount <VolatoBootstrap /> once without changing its data lifecycle",
    };
  }

  const wrapped = `<>\n      ${bootstrap}\n      ${componentRenders[0]}\n    </>`;
  const replaced = existing.replace(componentRenders[0], wrapped);
  writeFileSync(path, insertAfterLastImport(replaced, importLine), "utf8");
  return {
    path,
    status: "updated",
    detail: "mounted browser capture in the custom App",
  };
}

/**
 * Compose Pages Router's universal error component without replacing its UI.
 * The generated higher-order component delegates the original
 * `getInitialProps` and reports its actual `context.err` on client transitions;
 * server errors remain owned by Next's awaited `onRequestError` hook.
 */
export function patchPagesError(
  path: string,
  modulePath = "../volato/pages-error",
): PatchOutcome {
  const existing = readIfExists(path);
  const importLine = `import { withVolatoPagesError } from "${modulePath}";\n`;
  if (existing?.includes("withVolatoPagesError")) {
    return {
      path,
      status: "skipped",
      detail: "Pages Router error component already reports to Volato",
    };
  }
  if (existing === null) {
    ensureDir(path);
    writeFileSync(
      path,
      `import NextError from "next/error";\n${importLine}\nexport default withVolatoPagesError(NextError);\n`,
      "utf8",
    );
    return { path, status: "created" };
  }

  const located = findExportDefaultExpression(existing);
  if (!located) {
    return {
      path,
      status: "manual",
      detail:
        "custom `_error` has no parseable default export — wrap it with `withVolatoPagesError(...)` manually",
    };
  }
  const replaced =
    existing.slice(0, located.startIndex) +
    `export default withVolatoPagesError(${located.expression.trim()})` +
    existing.slice(located.endIndex);
  writeFileSync(path, insertAfterLastImport(replaced, importLine), "utf8");
  return {
    path,
    status: "updated",
    detail: "composed the existing Pages Router error component",
  };
}

/**
 * Build the snippet we tell the user to paste into their existing
 * `middleware.ts`. We never auto-mutate middleware — its shape varies far
 * too much across apps for a regex patch to be safe.
 *
 * The DSN and build release are read from `NEXT_PUBLIC_*` variables in the
 * host middleware file so Next.js inlines them before the generated Edge
 * module runs. The generated module itself stays free of `process.env`.
 */
export function buildMiddlewareSnippet(
  modulePath = "./volato/middleware",
  language: "ts" | "js" = "ts",
): string {
  const dsn =
    language === "ts"
      ? "process.env.NEXT_PUBLIC_VOLATO_DSN!"
      : "process.env.NEXT_PUBLIC_VOLATO_DSN";
  return `import { wrapMiddleware } from "${modulePath}";

export default wrapMiddleware(async (req) => {
  // your existing middleware logic
}, {
  dsn: ${dsn},
  release: process.env.NEXT_PUBLIC_VOLATO_RELEASE,
  commitSha: process.env.NEXT_PUBLIC_VOLATO_COMMIT_SHA,
  environment: process.env.NODE_ENV,
});`;
}

/**
 * Build the manual composition snippet for Next.js 16's Node-runtime
 * `proxy.ts`. Unlike Edge middleware, the generated server module can read
 * the injected DSN directly and await delivery before re-throwing.
 */
export function buildProxySnippet(modulePath = "./volato/server"): string {
  return `import { wrapProxy } from "${modulePath}";

export const proxy = wrapProxy(async (request) => {
  // your existing proxy logic
});`;
}

/**
 * Wrap the user's `next.config.{ts,js,mjs,cjs}` export with `withVolato()`.
 * Idempotent — bails with `skipped` if `withVolato` is already imported.
 *
 * Strategy: locate `export default`, walk forward through the value
 * expression with balanced bracket counting until the statement
 * terminator (`;` or end-of-file), wrap that exact slice. Falls back to
 * `manual` for `module.exports = …` shapes, missing exports, or any
 * config the walker can't parse confidently.
 *
 * The previous regex (`/export\s+default\s+([\s\S]+?)(;?\s*)$/`) was
 * non-greedy paired with `$`, which forces a match to EOF — eating any
 * subsequent `export const runtime = ...` adjacent to the default
 * export. The bracket walker stops at the actual statement boundary.
 */
export function patchNextConfig(
  path: string | null,
  modulePath = "./volato/withVolato",
  nextMajor?: number,
): PatchOutcome {
  if (!path) {
    return {
      path: "next.config",
      status: "manual",
      detail:
        "next.config not found — create one and wrap your config with `withVolato`",
    };
  }

  const original = readIfExists(path);
  if (original === null) {
    return {
      path,
      status: "manual",
      detail: "next.config disappeared between detection and patch",
    };
  }
  if (original.includes("withVolato")) {
    return { path, status: "skipped", detail: "already wraps withVolato" };
  }

  const located = findExportDefaultExpression(original);
  if (!located) {
    return {
      path,
      status: "manual",
      detail:
        "no parseable `export default` — wrap your export manually with `withVolato(...)`",
    };
  }

  const importLine = `import { withVolato } from "${modulePath}";\n`;
  const versionOptions =
    nextMajor === undefined ? "" : `, { nextMajor: ${nextMajor} }`;
  const wrappedSlice = `export default withVolato(${located.expression.trim()}${versionOptions})`;
  const replaced =
    original.slice(0, located.startIndex) +
    wrappedSlice +
    original.slice(located.endIndex);
  const withImport = original.includes(importLine)
    ? replaced
    : insertAfterLastImport(replaced, importLine);

  writeFileSync(path, withImport, "utf8");
  return { path, status: "updated", detail: "wrapped export default" };
}

type ExportDefaultLocation = {
  startIndex: number;
  endIndex: number;
  expression: string;
};

/**
 * Characters that, as the LAST significant char of the expression
 * captured so far, mean the statement is unfinished and continues past
 * a line break (trailing operator, member `.`, ternary `?`/`:`, comma).
 */
const TRAILING_CONTINUATION = new Set([
  ".",
  ",",
  "+",
  "-",
  "*",
  "/",
  "%",
  "=",
  "<",
  ">",
  "&",
  "|",
  "^",
  "?",
  ":",
]);

/**
 * Characters that, as the NEXT significant char after a top-level
 * newline, mean the following line continues the expression — a method
 * chain `.`, a ternary `?`/`:`, a binary operator, a call `(`, a
 * computed member `[`, or a tagged template. Mirrors JS ASI: a line
 * starting with one of these joins the previous line.
 */
const LEADING_CONTINUATION = new Set([
  ".",
  "?",
  ":",
  "+",
  "-",
  "*",
  "/",
  "%",
  "=",
  "<",
  ">",
  "&",
  "|",
  "^",
  "(",
  "[",
  "`",
]);

/**
 * The next significant character at or after `from`, skipping
 * whitespace, line comments, and block comments. `""` at end of input.
 */
function nextSignificantChar(source: string, from: number): string {
  let j = from;
  while (j < source.length) {
    const c = source[j]!;
    if (c === " " || c === "\t" || c === "\r" || c === "\n") {
      j += 1;
      continue;
    }
    if (c === "/" && source[j + 1] === "/") {
      j += 2;
      while (j < source.length && source[j] !== "\n") j += 1;
      continue;
    }
    if (c === "/" && source[j + 1] === "*") {
      j += 2;
      while (j < source.length && !(source[j] === "*" && source[j + 1] === "/"))
        j += 1;
      j += 2;
      continue;
    }
    return c;
  }
  return "";
}

/**
 * Whether the export expression continues past a top-level newline —
 * either because it ends on a continuation operator, or because the
 * next line begins with one. When neither holds, the newline is a real
 * statement boundary (e.g. an adjacent `export const runtime = ...`).
 */
function continuesPastNewline(lastSig: string, nextChar: string): boolean {
  if (TRAILING_CONTINUATION.has(lastSig)) return true;
  if (nextChar === "") return false;
  return LEADING_CONTINUATION.has(nextChar);
}

/**
 * Find `export default <expr>` in `source` and return the absolute
 * indices spanning the entire statement (from `export` to the
 * terminating `;`, a real top-level newline boundary, or EOF).
 *
 * Walks the expression with bracket/string/comment tracking so an
 * object literal, call, or arrow function with internal commas is
 * captured intact. A bare top-level newline only ends the statement
 * when the expression is genuinely complete there: a multi-line
 * ternary (`cond\n ? a\n : b`) or a builder chain (`base\n .with()\n
 * .build()`) is kept whole instead of being truncated mid-expression
 * (which previously produced a syntactically broken wrap that silently
 * disabled the config or crashed the build). Returns `null` when no
 * `export default` is found, or when the walker can't finish
 * confidently (unbalanced brackets, or an expression left dangling on
 * a continuation operator at EOF) — the caller then falls back to
 * `manual` rather than writing a guess.
 */
function findExportDefaultExpression(
  source: string,
): ExportDefaultLocation | null {
  const exportMatch = /(?:^|\n)\s*export\s+default\s+/.exec(source);
  if (!exportMatch) return null;

  const startIndex = exportMatch.index + exportMatch[0].search(/export/);
  const exprStart = exportMatch.index + exportMatch[0].length;

  let i = exprStart;
  let depthRound = 0;
  let depthSquare = 0;
  let depthCurly = 0;
  let inSingle = false;
  let inDouble = false;
  let inBacktick = false;
  let inLineComment = false;
  let inBlockComment = false;
  // Last non-whitespace, non-comment character consumed as part of the
  // expression — decides whether a top-level newline ends it.
  let lastSig = "";

  // `exprEnd` bounds the expression text (exclusive of any terminator);
  // `endIndex` is the replacement boundary — past the `;` when there is
  // one, so the wrap consumes it; otherwise the same as `exprEnd`.
  const finish = (
    exprEnd: number,
    endIndex: number,
  ): ExportDefaultLocation | null => {
    const expression = source.slice(exprStart, exprEnd).trim();
    if (expression.length === 0) return null;
    return { startIndex, endIndex, expression };
  };

  while (i < source.length) {
    const ch = source[i]!;
    const next = source[i + 1] ?? "";

    if (inLineComment) {
      // A line comment runs to its newline; that newline is still a
      // real top-level break, so fall through to the shared handling
      // below instead of consuming it here.
      if (ch !== "\n") {
        i += 1;
        continue;
      }
      inLineComment = false;
    } else if (inBlockComment) {
      if (ch === "*" && next === "/") {
        inBlockComment = false;
        i += 2;
      } else {
        i += 1;
      }
      continue;
    } else if (inSingle) {
      if (ch === "\\") {
        i += 2;
        continue;
      }
      if (ch === "'") inSingle = false;
      lastSig = ch;
      i += 1;
      continue;
    } else if (inDouble) {
      if (ch === "\\") {
        i += 2;
        continue;
      }
      if (ch === '"') inDouble = false;
      lastSig = ch;
      i += 1;
      continue;
    } else if (inBacktick) {
      if (ch === "\\") {
        i += 2;
        continue;
      }
      if (ch === "`") inBacktick = false;
      lastSig = ch;
      i += 1;
      continue;
    } else {
      if (ch === "/" && next === "/") {
        inLineComment = true;
        i += 2;
        continue;
      }
      if (ch === "/" && next === "*") {
        inBlockComment = true;
        i += 2;
        continue;
      }
      if (ch === "'") {
        inSingle = true;
        lastSig = ch;
        i += 1;
        continue;
      }
      if (ch === '"') {
        inDouble = true;
        lastSig = ch;
        i += 1;
        continue;
      }
      if (ch === "`") {
        inBacktick = true;
        lastSig = ch;
        i += 1;
        continue;
      }

      if (ch === "(") depthRound += 1;
      else if (ch === ")") depthRound -= 1;
      else if (ch === "[") depthSquare += 1;
      else if (ch === "]") depthSquare -= 1;
      else if (ch === "{") depthCurly += 1;
      else if (ch === "}") depthCurly -= 1;

      const atTopLevel =
        depthRound === 0 && depthSquare === 0 && depthCurly === 0;

      // A top-level `;` always closes the statement; the expression
      // ends before it, the replacement boundary consumes it.
      if (atTopLevel && ch === ";") {
        return finish(i, i + 1);
      }

      if (ch !== "\n") {
        if (!/\s/.test(ch)) lastSig = ch;
        i += 1;
        continue;
      }
      // ch === "\n": fall through to the shared newline handling below.
    }

    // Shared top-level newline handling — reached from plain code or
    // from the close of a line comment.
    const atTop = depthRound === 0 && depthSquare === 0 && depthCurly === 0;
    if (
      atTop &&
      !continuesPastNewline(lastSig, nextSignificantChar(source, i + 1))
    ) {
      return finish(i, i);
    }
    i += 1;
  }

  // EOF — accept only if brackets balanced and the expression isn't
  // left dangling on a continuation operator (which means incomplete).
  const balanced = depthRound === 0 && depthSquare === 0 && depthCurly === 0;
  if (balanced && !TRAILING_CONTINUATION.has(lastSig)) {
    return finish(source.length, source.length);
  }
  return null;
}

/**
 * Create the canonical App Router render error boundary. Existing application
 * boundaries own user-facing recovery UI, so they are never rewritten: setup
 * reports a manual composition outcome instead.
 */
export function patchErrorBoundary(
  path: string,
  modulePath = "../volato/error-boundary",
  language: "ts" | "js" = path.endsWith(".jsx") ? "js" : "ts",
): PatchOutcome {
  const existing = readIfExists(path);
  if (existing && existing.includes("captureFromErrorBoundary")) {
    return {
      path,
      status: "skipped",
      detail: "React error boundary already reports to Volato",
    };
  }
  if (existing) {
    return {
      path,
      status: "manual",
      detail: `error boundary exists — call captureFromErrorBoundary(error) from "${modulePath}" in a useEffect`,
    };
  }

  ensureDir(path);
  const props =
    language === "ts"
      ? `{
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}`
      : "{ error, reset }";
  writeFileSync(
    path,
    `"use client";

import { useEffect } from "react";
import { captureFromErrorBoundary } from "${modulePath}";

export default function Error(${props}) {
  useEffect(() => {
    captureFromErrorBoundary(error);
  }, [error]);

  return (
    <main>
      <h1>Something went wrong</h1>
      <button type="button" onClick={() => reset()}>
        Try again
      </button>
    </main>
  );
}
`,
    "utf8",
  );
  return { path, status: "created" };
}
