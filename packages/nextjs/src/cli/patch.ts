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
 *   - `patchTunnelRoute`         create `app/monitoring/route.ts`
 *   - `buildMiddlewareSnippet`   the only one that doesn't write
 *                                — middleware shapes vary too
 *                                much for a regex patch to be
 *                                safe, so we hand the user a
 *                                snippet to paste themselves.
 *
 * Every patch returns a `PatchOutcome` with one of four
 * statuses (`created` / `updated` / `skipped` / `manual`) so
 * the orchestrator can render the final report without re-
 * reading the file. `skipped` means the marker
 * `@volatodev/nextjs` was already present — re-running
 * `volato init` is safe.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export type PatchStatus = "created" | "updated" | "skipped" | "manual";

export type PatchOutcome = {
  path: string;
  status: PatchStatus;
  detail?: string;
};

const VOLATO_MARKER = "@volatodev/nextjs";

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
 * (only used at build / CI time, not at SDK runtime).
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
 * Create `instrumentation.ts` (or `.js`) re-exporting the SDK hook.
 *
 * Both .ts and .js variants emit ESM `export { onRequestError }` —
 * `@volatodev/nextjs` is `"type": "module"` and cannot be required
 * from CJS without a top-level await. For JS projects without
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
): PatchOutcome {
  const existing = readIfExists(path);
  if (existing && existing.includes(VOLATO_MARKER)) {
    return {
      path,
      status: "skipped",
      detail: "instrumentation already wires @volatodev/nextjs",
    };
  }
  if (existing) {
    return {
      path,
      status: "manual",
      detail:
        'instrumentation file exists — add `export { onRequestError } from "@volatodev/nextjs/instrumentation"` manually',
    };
  }

  ensureDir(path);
  // Same ESM body for both .ts and .js. Next.js is happy to load ESM
  // instrumentation.js when the project's package.json has
  // `"type": "module"`. If it doesn't, the JS variant requires the
  // user to opt in — flagged via the `detail` field below.
  const body = `export { onRequestError } from "@volatodev/nextjs/instrumentation";\n`;
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
 * just mounts the browser SDK). Next.js allows client components to
 * render inside server components, so this works whether or not the
 * layout is `"use client"`. The render-phase error boundary belongs in
 * `app/error.tsx` / `app/global-error.tsx` — App Router's file-system
 * mechanism — not wrapped around the layout: that path is incompatible
 * with server layouts and competes with Next's own error handling.
 *
 * Falls back to `manual` when the layout shape is unusual.
 */
export function patchLayout(path: string): PatchOutcome {
  const original = readIfExists(path);
  if (original === null) {
    return {
      path,
      status: "manual",
      detail: "layout file not found — copy the snippet from the docs",
    };
  }
  if (original.includes(VOLATO_MARKER)) {
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

  const importBlock = `import { VolatoBootstrap } from "@volatodev/nextjs/client";\n`;
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
export function buildMiddlewareSnippet(): string {
  return `import { wrapMiddleware } from "@volatodev/nextjs/middleware";

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
export function patchNextConfig(path: string | null): PatchOutcome {
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

  const importLine = `import { withVolato } from "@volatodev/nextjs";\n`;
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
 * Find `export default <expr>` in `source` and return the absolute
 * indices spanning the entire statement (from `export` to the
 * terminating `;` or just past the expression at EOF).
 *
 * Walks the expression with bracket counting so an object literal,
 * call, or arrow function with internal commas is captured intact.
 * Returns `null` if no `export default` is found, or if the walker
 * runs into a shape it can't handle confidently (e.g. an unclosed
 * string).
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

  while (i < source.length) {
    const ch = source[i]!;
    const next = source[i + 1] ?? "";

    if (inLineComment) {
      if (ch === "\n") inLineComment = false;
      i += 1;
      continue;
    }
    if (inBlockComment) {
      if (ch === "*" && next === "/") {
        inBlockComment = false;
        i += 2;
        continue;
      }
      i += 1;
      continue;
    }
    if (inSingle) {
      if (ch === "\\") {
        i += 2;
        continue;
      }
      if (ch === "'") inSingle = false;
      i += 1;
      continue;
    }
    if (inDouble) {
      if (ch === "\\") {
        i += 2;
        continue;
      }
      if (ch === '"') inDouble = false;
      i += 1;
      continue;
    }
    if (inBacktick) {
      if (ch === "\\") {
        i += 2;
        continue;
      }
      if (ch === "`") inBacktick = false;
      i += 1;
      continue;
    }

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
      i += 1;
      continue;
    }
    if (ch === '"') {
      inDouble = true;
      i += 1;
      continue;
    }
    if (ch === "`") {
      inBacktick = true;
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

    if (atTopLevel && (ch === ";" || ch === "\n")) {
      const expression = source.slice(exprStart, i).trim();
      if (expression.length === 0) return null;
      // Include the `;` in the slice we replace; otherwise stop just
      // before the newline (no trailing semicolon to swallow).
      const endIndex = ch === ";" ? i + 1 : i;
      return { startIndex, endIndex, expression };
    }

    i += 1;
  }

  // EOF without a `;`/newline at top level — accept what we have if
  // the brackets balanced.
  if (depthRound === 0 && depthSquare === 0 && depthCurly === 0) {
    const expression = source.slice(exprStart).trim();
    if (expression.length === 0) return null;
    return { startIndex, endIndex: source.length, expression };
  }
  return null;
}

/**
 * Create the same-origin tunnel route at `app/monitoring/route.ts`. The
 * SDK's browser transport posts to `/monitoring` by default.
 */
export function patchTunnelRoute(
  path: string,
  language: "ts" | "js",
): PatchOutcome {
  const existing = readIfExists(path);
  if (existing && existing.includes("createTunnelHandler")) {
    return { path, status: "skipped", detail: "tunnel handler already present" };
  }
  if (existing) {
    return {
      path,
      status: "manual",
      detail: 'route.ts exists — add `export const POST = createTunnelHandler()` manually',
    };
  }
  ensureDir(path);
  const body =
    language === "ts"
      ? `import { createTunnelHandler } from "@volatodev/nextjs/server";\n\nexport const POST = createTunnelHandler();\n`
      : `const { createTunnelHandler } = require("@volatodev/nextjs/server");\n\nexports.POST = createTunnelHandler();\n`;
  writeFileSync(path, body, "utf8");
  return { path, status: "created" };
}
