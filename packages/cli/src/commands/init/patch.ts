/**
 * The actual file mutations `volato init` performs. Lives apart
 * from `init.ts` (the orchestrator) so each patch is a small,
 * focused, idempotent function:
 *
 *   - `patchEnvLocal`            append the two DSN env vars
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
 * Append the Volato DSN to `.env.local`, preserving any existing file
 * content. Idempotent: a key that already exists is never duplicated.
 *
 * Single source of truth: `NEXT_PUBLIC_VOLATO_DSN`. Next.js exposes
 * `NEXT_PUBLIC_*` to server-side code too, so we don't need a separate
 * `VOLATO_DSN` server twin. The `VOLATO_INGEST_TOKEN` is *not* written
 * by the CLI — the developer copies it from the dashboard themselves
 * (only used at build / CI time, not at application runtime).
 */
export function patchEnvLocal(cwd: string, dsn: string): PatchOutcome {
  const path = `${cwd}/.env.local`;
  const existing = readIfExists(path) ?? "";

  const keys: Array<{ key: string; value: string }> = [
    { key: "NEXT_PUBLIC_VOLATO_DSN", value: dsn },
  ];

  const lines = existing.split("\n");
  const present = new Set(
    lines
      .map((l) => l.match(/^([A-Z0-9_]+)\s*=/))
      .filter((m): m is RegExpMatchArray => m !== null)
      .map((m) => m[1]!),
  );

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
 * Create `instrumentation.ts` (or `.js`) re-exporting the generated hook.
 *
 * Both .ts and .js variants emit ESM `export { onRequestError }`.
 * For JS projects without
 * `"type": "module"` in their own package.json, a CJS-style file
 * would either fail to parse (Node ESM) or fail at runtime (`require`
 * an ESM-only export). We emit ESM and document the project-side
 * requirement when called via the CLI.
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
  // Same ESM body for both .ts and .js. Next.js is happy to load ESM
  // instrumentation.js when the project's package.json has
  // `"type": "module"`. If it doesn't, the JS variant requires the
  // user to opt in — flagged via the `detail` field below.
  const body = `export { onRequestError } from "${modulePath}";\n`;
  writeFileSync(path, body, "utf8");

  const detail =
    language === "js"
      ? 'created (requires "type": "module" in your package.json — switch to TypeScript or set the field if your project is CJS)'
      : undefined;
  return { path, status: "created", ...(detail ? { detail } : {}) };
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
  const insertion =
    '<VolatoBootstrap dsn={process.env.NEXT_PUBLIC_VOLATO_DSN!} />\n        {children}';

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
 * Build the snippet we tell the user to paste into their existing
 * `middleware.ts`. We never auto-mutate middleware — its shape varies far
 * too much across apps for a regex patch to be safe.
 *
 * The DSN is read from `NEXT_PUBLIC_VOLATO_DSN` because Edge runtime does
 * not get arbitrary `process.env.*` injected at build time — only
 * `NEXT_PUBLIC_*` values are inlined. The DSN is a write-grant secret
 * designed to be safe in browser bundles, so the public prefix is the
 * correct shape for Edge too.
 */
export function buildMiddlewareSnippet(
  modulePath = "./volato/middleware",
): string {
  return `import { wrapMiddleware } from "${modulePath}";

export default wrapMiddleware(async (req) => {
  // your existing middleware logic
}, { dsn: process.env.NEXT_PUBLIC_VOLATO_DSN! });`;
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
        'no parseable `export default` — wrap your export manually with `withVolato(...)`',
    };
  }

  const importLine = `import { withVolato } from "${modulePath}";\n`;
  const wrappedSlice = `export default withVolato(${located.expression.trim()})`;
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
  writeFileSync(
    path,
    `"use client";

import { useEffect } from "react";
import { captureFromErrorBoundary } from "${modulePath}";

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
