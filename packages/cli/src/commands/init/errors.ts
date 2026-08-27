/**
 * Orchestrator for `volato errors init`. Four responsibilities:
 *
 *   1. Read the project linked by `volato init` and fetch its credentials.
 *   2. Drive the interactive safety and verification prompts.
 *   3. Call the deterministic adapters applicable to the detected project.
 *   4. Print a final report — one line per touched file with
 *      its `created / updated / skipped / manual` outcome — so
 *      the dev sees exactly what was modified before running
 *      `next dev`.
 *
 * Why these three live in one orchestrator instead of inside
 * commander: the orchestrator takes explicit options so a test can drive the full flow
 * end-to-end against a fixture project without spawning a
 * subprocess.
 */

import { dirname, join, relative } from "node:path";
import pc from "picocolors";
import prompts from "prompts";
import {
  detectErrorsStack,
  ErrorsStackDetectionError,
} from "./detect-errors.js";
import {
  buildMiddlewareSnippet,
  buildProxySnippet,
  type PatchOutcome,
  type PatchStatus,
} from "./patch";
import { generateNextjsIntegration } from "../../integrations/nextjs";
import { generateBrowserReactIntegration } from "../../integrations/vite-react.js";
import { generateNodeIntegration } from "../../integrations/node.js";
import { generateNodeInvocationIntegration } from "../../integrations/node-invocation.js";
import { linkedProject } from "../../integrations/manifest.js";
import {
  fetchProjectSetup,
  reportIntegrationInstalled,
} from "./project-setup.js";
import { ensureGitignoreCoversEnvLocal } from "./local-credentials.js";
import { verifyGeneratedNextjsIntegration } from "./verify-nextjs.js";

export type ErrorsInitOptions = {
  cwd: string;
  nonInteractive?: boolean;
  sendTestEvent?: boolean;
};

const STATUS_BADGE: Record<PatchStatus, string> = {
  created: pc.green("created"),
  updated: pc.cyan("updated"),
  skipped: pc.dim("skipped"),
  manual: pc.yellow("manual"),
};

function isValidDsn(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

function relpath(cwd: string, abs: string): string {
  return abs.startsWith(cwd) ? abs.slice(cwd.length).replace(/^\//, "") : abs;
}

function printOutcome(cwd: string, outcome: PatchOutcome): void {
  const badge = STATUS_BADGE[outcome.status];
  const detail = outcome.detail ? pc.dim(` — ${outcome.detail}`) : "";
  process.stdout.write(`  ${badge}  ${relpath(cwd, outcome.path)}${detail}\n`);
}

export async function runErrorsInit(options: ErrorsInitOptions): Promise<void> {
  const { cwd } = options;

  process.stdout.write(`${pc.bold("volato")} errors init  ${pc.dim(cwd)}\n\n`);

  let stack;
  try {
    stack = detectErrorsStack(cwd);
  } catch (err) {
    if (err instanceof ErrorsStackDetectionError) {
      throw new Error(err.message);
    }
    throw err;
  }

  const projectLink = linkedProject(cwd);
  const setup = await fetchProjectSetup(projectLink.id);
  if (!isValidDsn(setup.dsn)) {
    throw new Error(`Invalid DSN returned for this project.`);
  }

  // Protect the local secret before any integration code writes `.env.local`.
  // A non-interactive agent must never create a commit-ready token file first
  // and patch `.gitignore` afterwards.
  await ensureGitignoreCoversEnvLocal(cwd, options.nonInteractive);

  const outcomes: PatchOutcome[] = [];
  let nextjsRuntimeRoot: string | null = null;

  if (stack.nextjs) {
    const generated = generateNextjsIntegration({
      cwd,
      dsn: setup.dsn,
      ingestToken: setup.ingestToken,
      project: stack.nextjs,
    });
    nextjsRuntimeRoot = generated.runtimeRoot;
    outcomes.push(
      {
        path: generated.runtimeRoot,
        status: "created",
        detail: `${generated.generatedFiles.length} local Next.js runtime files`,
      },
      ...generated.outcomes,
      {
        path: generated.manifestPath,
        status: "created",
        detail: "generated-file integrity manifest",
      },
    );
  } else {
    if (stack.browserReact) {
      const generated = generateBrowserReactIntegration({
        cwd,
        dsn: setup.dsn,
        ingestToken: setup.ingestToken,
        project: stack.browserReact,
      });
      outcomes.push(
        {
          path: generated.runtimeRoot,
          status: "created",
          detail: `${generated.generatedFiles.length} local ${stack.browserReact.buildAdapter} + React browser files`,
        },
        ...generated.outcomes,
        {
          path: generated.manifestPath,
          status: "created",
          detail: "generated-file integrity manifest",
        },
      );
    }
    if (stack.node) {
      const generated = generateNodeIntegration({
        cwd,
        dsn: setup.dsn,
        ingestToken: setup.ingestToken,
        project: stack.node,
      });
      outcomes.push(
        {
          path: generated.runtimeRoot,
          status: "created",
          detail: `${generated.generatedFiles.length} local Node runtime files`,
        },
        ...generated.outcomes,
        {
          path: generated.manifestPath,
          status: "created",
          detail: "generated-file integrity manifest",
        },
      );
    }
    if (stack.nodeInvocation) {
      const generated = generateNodeInvocationIntegration({
        cwd,
        dsn: setup.dsn,
        ingestToken: setup.ingestToken,
        project: stack.nodeInvocation,
      });
      outcomes.push(
        {
          path: generated.runtimeRoot,
          status: "created",
          detail: `${generated.generatedFiles.length} local Node invocation files`,
        },
        ...generated.outcomes,
        {
          path: generated.manifestPath,
          status: "created",
          detail: "generated-file integrity manifest",
        },
      );
    }
  }
  if (options.sendTestEvent && !stack.nextjs) {
    outcomes.push({
      path: cwd,
      status: "manual",
      detail:
        "--send-test-event is currently a Next.js-only verifier; run the browser and Node/Express conformance scenarios from their integration skills",
    });
  }

  for (const o of outcomes) printOutcome(cwd, o);
  process.stdout.write("\n");
  const manualOutcomes = outcomes.filter(
    (outcome) => outcome.status === "manual",
  );

  if (manualOutcomes.length === 0) {
    if (stack.nextjs) {
      await reportIntegrationInstalled(projectLink.id, "errors-nextjs");
    }
    if (stack.browserReact) {
      await reportIntegrationInstalled(projectLink.id, "errors-vite-react");
    }
    if (stack.node) {
      await reportIntegrationInstalled(projectLink.id, "errors-node");
    }
    if (stack.nodeInvocation) {
      await reportIntegrationInstalled(
        projectLink.id,
        "errors-node-invocation",
      );
    }
  }

  if (manualOutcomes.length === 0 && stack.nextjs && nextjsRuntimeRoot) {
    await maybeSendTestEvent(
      {
        cwd,
        appDir: stack.nextjs.appDir,
        pagesDir: stack.nextjs.pagesDir,
        runtimeRoot: nextjsRuntimeRoot,
        dsn: setup.dsn,
        language: stack.nextjs.language,
      },
      options.nonInteractive,
      options.sendTestEvent,
    );
  }

  for (const notice of stack.notices) {
    process.stdout.write(`  ${pc.yellow("!")} ${notice}\n`);
  }
  if (stack.nextjs && nextjsRuntimeRoot) {
    printNextSteps(
      stack.nextjs.middlewarePath,
      stack.nextjs.proxyPath,
      nextjsRuntimeRoot,
      cwd,
      manualOutcomes.length === 0,
      stack.nextjs.language,
      stack.nextjs.routerKind,
    );
  } else {
    printPortableNextSteps(
      cwd,
      Boolean(stack.browserReact),
      Boolean(stack.node),
      Boolean(stack.nodeInvocation),
      manualOutcomes.length === 0,
    );
  }
  if (manualOutcomes.length > 0) {
    throw new Error(
      `Integration setup is incomplete: ${manualOutcomes.length} file${
        manualOutcomes.length === 1 ? "" : "s"
      } require manual composition.`,
    );
  }
}

/**
 * Offer to verify the generated integration immediately after `init`
 * succeeds. The verifier starts the project's real Next.js runtime with a
 * temporary Route Handler, captures an Error through the generated server
 * module, and requires the ingest endpoint to accept it.
 *
 * Interactive verification is best-effort because the project files are
 * already patched. An explicit `--send-test-event` is a machine-checkable
 * contract, so a rejected capture makes the command fail.
 */
async function maybeSendTestEvent(
  verification: Parameters<typeof verifyGeneratedNextjsIntegration>[0],
  nonInteractive = false,
  sendExplicitly = false,
): Promise<void> {
  const response = nonInteractive
    ? { send: sendExplicitly }
    : await prompts(
        {
          type: "confirm",
          name: "send",
          message: "Send a test error now to verify the pipe?",
          initial: true,
        },
        {
          onCancel: () => {
            throw new Error("aborted by user");
          },
        },
      );
  if (!response.send) return;

  try {
    await verifyGeneratedNextjsIntegration(verification);
    process.stdout.write(
      `  ${pc.green(
        "✓",
      )} Generated Next.js integration captured a test error with a stack.\n\n`,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stdout.write(
      `  ${pc.red("✗")} Could not send test event: ${pc.dim(msg)}\n` +
        `    ${pc.dim(
          "Your project files were still patched — fix the local Next.js / ingest error and retry.",
        )}\n\n`,
    );
    if (sendExplicitly) {
      throw err instanceof Error ? err : new Error(msg);
    }
  }
}

function localModule(fromFile: string, target: string): string {
  let path = relative(dirname(fromFile), target).replaceAll("\\", "/");
  if (!path.startsWith(".")) path = `./${path}`;
  return path;
}

function printPortableNextSteps(
  cwd: string,
  hasBrowser: boolean,
  hasNode: boolean,
  hasNodeInvocation: boolean,
  complete: boolean,
): void {
  process.stdout.write(`${pc.bold("Next steps")}\n`);
  process.stdout.write(
    `  ${pc.dim(
      "1.",
    )} Review the generated integration and run the repository's production build.\n`,
  );
  let step = 2;
  if (hasBrowser) {
    process.stdout.write(
      `  ${pc.dim(
        `${step}.`,
      )} Exercise one window error, one unhandled rejection, and one React render error.\n`,
    );
    step += 1;
  }
  if (hasNode) {
    process.stdout.write(
      `  ${pc.dim(`${step}.`)} Set ${pc.cyan(
        "VOLATO_RELEASE",
      )} to the deployed Git SHA and exercise a controlled Node/Express error.\n`,
    );
    step += 1;
  }
  if (hasNodeInvocation) {
    process.stdout.write(
      `  ${pc.dim(`${step}.`)} Set ${pc.cyan(
        "VOLATO_RELEASE",
      )} to the deployed Git SHA and exercise one controlled Node invocation failure.\n`,
    );
    step += 1;
  }
  process.stdout.write(
    `  ${pc.dim(`${step}.`)} In CI, keep ${pc.cyan(
      "VOLATO_INGEST_TOKEN",
    )} server-only and verify the uploaded maps contain no ${pc.cyan(
      "sourcesContent",
    )}.\n\n`,
  );
  if (complete) {
    process.stdout.write(
      `${pc.green("✓")} ${pc.bold("Volato Errors files are composed.")} ${pc.dim(
        "Run the production build and applicable capture checks before deployment.",
      )}\n`,
    );
  } else {
    process.stdout.write(
      `${pc.yellow("!")} Setup incomplete. ${pc.dim(
        `Complete every manual file action above, then rerun \`volato errors init\` from ${
          relpath(cwd, cwd) || "the application root"
        }.`,
      )}\n`,
    );
  }
}

function printNextSteps(
  middlewarePath: string | null,
  proxyPath: string | null,
  runtimeRoot: string,
  cwd: string,
  complete: boolean,
  language: "ts" | "js",
  routerKind: "app" | "pages" | "hybrid",
): void {
  const runtimeExtension = language === "js" ? ".js" : "";
  process.stdout.write(`${pc.bold("Next steps")}\n`);
  process.stdout.write(
    `  ${pc.dim("1.")} Restart your dev server so the new env vars load.\n`,
  );

  if (proxyPath) {
    const rel = relpath(cwd, proxyPath);
    process.stdout.write(
      `  ${pc.dim("2.")} Wrap your proxy (${pc.cyan(rel)}):\n\n`,
    );
    const snippet = buildProxySnippet(
      localModule(proxyPath, join(runtimeRoot, `server${runtimeExtension}`)),
    )
      .split("\n")
      .map((line) => `       ${line}`)
      .join("\n");
    process.stdout.write(`${pc.dim(snippet)}\n\n`);
  } else if (middlewarePath) {
    const rel = relpath(cwd, middlewarePath);
    process.stdout.write(
      `  ${pc.dim("2.")} Wrap your middleware (${pc.cyan(rel)}):\n\n`,
    );
    const snippet = buildMiddlewareSnippet(
      localModule(
        middlewarePath,
        join(runtimeRoot, `middleware${runtimeExtension}`),
      ),
      language,
    )
      .split("\n")
      .map((line) => `       ${line}`)
      .join("\n");
    process.stdout.write(`${pc.dim(snippet)}\n\n`);
  } else {
    process.stdout.write(
      `  ${pc.dim("2.")} If you add a middleware later, wrap it with ${pc.cyan(
        "wrapMiddleware",
      )}.\n`,
    );
  }

  if (routerKind === "pages") {
    process.stdout.write(
      `  ${pc.dim(
        "3.",
      )} Pages Router render, SSR and API Route throws are captured by the generated instrumentation and error component.\n`,
    );
  } else {
    process.stdout.write(
      `  ${pc.dim("3.")} For Route Handlers, wrap each export with ${pc.cyan(
        "wrapRoute",
      )} from your generated ${pc.cyan(
        `${relpath(cwd, runtimeRoot)}/server`,
      )} module.\n`,
    );
    process.stdout.write(
      `  ${pc.dim("4.")} For Server Actions returning ${pc.cyan(
        "{ error }",
      )} (no throw), call ${pc.cyan(
        "reportActionError",
      )} from the generated server module.\n`,
    );
  }
  // The token gates the automatic sourcemap upload that the generated
  // `withVolato()` build helper performs at `next build`. Without it, prod errors arrive as
  // minified frames and the agent can't open the offending file.
  // Find it on the project's settings page alongside the DSN.
  const buildStep = routerKind === "pages" ? "4." : "5.";
  process.stdout.write(
    `  ${pc.dim(buildStep)} ${pc.bold("(CI)")} Set ${pc.cyan(
      "VOLATO_INGEST_TOKEN",
    )} in your CI environment — ${pc.cyan(
      "withVolato()",
    )} uses it to upload\n     sourcemaps at ${pc.cyan(
      "next build",
    )}. Without it, prod errors show minified frames.\n\n`,
  );
  if (complete) {
    process.stdout.write(
      `${pc.green("✓")} ${pc.bold("Volato Errors files are composed.")} ${pc.dim(
        "Run the production build and applicable capture checks before deployment.",
      )}\n`,
    );
  } else {
    process.stdout.write(
      `${pc.yellow("!")} Setup incomplete. ${pc.dim(
        "Complete every manual file action above, then rerun `volato errors init`.",
      )}\n`,
    );
  }
}
