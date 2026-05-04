/**
 * Idempotent file mutations used by `volato init`. Each function returns a
 * `PatchOutcome` so the orchestrator can report "created" / "updated" /
 * "skipped" without having to read the file twice.
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
 * Append the two Volato env vars to `.env.local`, preserving any existing
 * file content. Idempotent: a key that already exists is never duplicated.
 */
export function patchEnvLocal(cwd: string, dsn: string): PatchOutcome {
  const path = `${cwd}/.env.local`;
  const existing = readIfExists(path) ?? "";

  const keys: Array<{ key: string; value: string }> = [
    { key: "VOLATO_DSN", value: dsn },
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
 * Create `instrumentation.ts` (or `.js`) re-exporting the SDK hook. If the
 * file already exists with a Volato marker, skip; if it exists without one,
 * return `manual` so the orchestrator can warn the user.
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
        'instrumentation.ts exists — add `export { onRequestError } from "@volatodev/nextjs/instrumentation"` manually',
    };
  }

  ensureDir(path);
  const body =
    language === "ts"
      ? `export { onRequestError } from "@volatodev/nextjs/instrumentation";\n`
      : `// instrumentation.js — Volato hook\nmodule.exports = require("@volatodev/nextjs/instrumentation");\n`;
  writeFileSync(path, body, "utf8");

  return { path, status: "created" };
}

/**
 * Patch `app/layout.tsx`:
 *
 *   1. Add two imports: VolatoBootstrap + VolatoErrorBoundary.
 *   2. Wrap the first `{children}` occurrence with `<VolatoErrorBoundary>`
 *      and a sibling `<VolatoBootstrap dsn={...} />`.
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
          : "multiple `{children}` usages — wrap the right one manually",
    };
  }

  const importBlock = `import { VolatoBootstrap } from "@volatodev/nextjs/client";\nimport { VolatoErrorBoundary } from "@volatodev/nextjs/error-boundary";\n`;
  const wrapped =
    "<VolatoErrorBoundary>\n        <VolatoBootstrap dsn={process.env.NEXT_PUBLIC_VOLATO_DSN!} />\n        {children}\n      </VolatoErrorBoundary>";

  const withWrap = original.replace("{children}", wrapped);
  const withImports = insertAfterLastImport(withWrap, importBlock);

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
 */
export function buildMiddlewareSnippet(): string {
  return `import { wrapMiddleware } from "@volatodev/nextjs/middleware";

export default wrapMiddleware(async (req) => {
  // your existing middleware logic
}, { dsn: process.env.VOLATO_DSN! });`;
}

/**
 * Wrap the user's `next.config.{ts,js,mjs,cjs}` export with `withVolato()`.
 * Idempotent — bails with `skipped` if `withVolato` is already imported.
 *
 * Strategy: regex-rewrite `export default <expr>` → `export default
 * withVolato(<expr>)`, and prepend the import. Falls back to `manual` for
 * config files using `module.exports = …` or unusual shapes.
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

  const exportRegex = /export\s+default\s+([\s\S]+?)(;?\s*)$/;
  const match = original.match(exportRegex);
  if (!match) {
    return {
      path,
      status: "manual",
      detail:
        'no `export default` found — wrap your export manually with `withVolato(...)`',
    };
  }

  const importLine = `import { withVolato } from "@volatodev/nextjs";\n`;
  const wrapped = `export default withVolato(${match[1]!.trim()})${match[2] ?? ""}`;
  const replaced = original.replace(exportRegex, wrapped);
  const withImport = original.includes(importLine)
    ? replaced
    : insertAfterLastImport(replaced, importLine);

  writeFileSync(path, withImport, "utf8");
  return { path, status: "updated", detail: "wrapped export default" };
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
