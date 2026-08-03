import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { UsageConfig } from "../commands/analytics-contract";
import { detectProject } from "../commands/init/detect";
import { generateAnalyticsNextjsIntegration } from "../integrations/analytics-nextjs";
import {
  ANALYTICS_NEXTJS_INTEGRATION,
  createGeneratedIntegration,
  ERRORS_NEXTJS_INTEGRATION,
  linkProject,
  modifiedGeneratedFiles,
  readManifest,
  writeIntegration,
} from "../integrations/manifest";

const here = dirname(fileURLToPath(import.meta.url));
const trackerSource = resolve(
  here,
  "../../skills/volato-product/assets/analytics-tracker.ts",
);

const config: UsageConfig = {
  schemaVersion: 1,
  projectId: "11111111-1111-4111-8111-111111111111",
  product: { summary: "Checkout", targetActor: "Signed-in buyer" },
  job: { statement: "Buy a product", outcome: "Order confirmed" },
  events: [
    {
      name: "checkout_started",
      description: "A buyer starts checkout.",
      properties: {},
      dedupe: "actor",
    },
    {
      name: "order_confirmed",
      description: "The order commits.",
      properties: {},
      dedupe: "key",
    },
  ],
  milestones: [
    { event: "checkout_started", question: "Did checkout start?" },
    { event: "order_confirmed", question: "Was the order confirmed?" },
  ],
  cohort: { event: "checkout_started", windowDays: 35 },
  activation: { event: "order_confirmed" },
  repeat: { event: "order_confirmed", minHours: 24 },
  retention: { event: "order_confirmed", minDays: 7, maxDays: 35 },
};

let cwd: string;

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), "volato-analytics-recipe-"));
  mkdirSync(join(cwd, "src", "app"), { recursive: true });
  writeFileSync(
    join(cwd, "package.json"),
    JSON.stringify({
      name: "fixture",
      dependencies: { next: "16.2.12", react: "19.2.8" },
    }),
  );
  writeFileSync(
    join(cwd, "src", "app", "layout.tsx"),
    "export default function Layout({ children }) { return <body>{children}</body>; }\n",
  );
  writeFileSync(join(cwd, "next.config.ts"), "export default {};\n");
  linkProject(cwd, {
    id: config.projectId,
    name: "Checkout",
  });
});

afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
});

describe("Next.js Analytics generated integration", () => {
  it("refuses to write before the repository is connected", () => {
    rmSync(join(cwd, ".volato", "manifest.json"));

    expect(() =>
      generateAnalyticsNextjsIntegration({
        cwd,
        dsn: `https://public@api.volato.dev/${config.projectId}`,
        ingestToken: "server-only-token",
        project: detectProject(cwd),
        config,
        trackerSource,
      }),
    ).toThrow(/volato init --project/);
    expect(existsSync(join(cwd, "src", "volato"))).toBe(false);
  });

  it("generates a typed tracker without replacing Errors ownership", () => {
    const errorsFile = join(cwd, "src", "volato", "client.tsx");
    mkdirSync(dirname(errorsFile), { recursive: true });
    writeFileSync(errorsFile, "export const errors = true;\n");
    writeIntegration(
      cwd,
      ERRORS_NEXTJS_INTEGRATION,
      createGeneratedIntegration(cwd, {
        recipe: "errors-nextjs-app-router",
        recipeVersion: "2.0.1",
        files: [errorsFile],
      }),
    );

    const result = generateAnalyticsNextjsIntegration({
      cwd,
      dsn: `https://public@api.volato.dev/${config.projectId}`,
      ingestToken: "server-only-token",
      project: detectProject(cwd),
      config,
      trackerSource,
    });

    expect(existsSync(join(cwd, "src", "volato", "analytics", "tracker.ts"))).toBe(
      true,
    );
    expect(
      readFileSync(join(cwd, "src", "volato", "analytics", "index.ts"), "utf8"),
    ).toContain('"name": "checkout_started"');
    expect(readManifest(cwd)?.integrations[ERRORS_NEXTJS_INTEGRATION]).toBeDefined();
    const analytics = readManifest(cwd)?.integrations[
      ANALYTICS_NEXTJS_INTEGRATION
    ];
    expect(analytics?.recipe).toBe("analytics-nextjs-app-router");
    expect(modifiedGeneratedFiles(cwd, analytics!)).toEqual([]);
    expect(result.generatedFiles).toHaveLength(2);
  });

  it("refuses to overwrite an edited Analytics tracker", () => {
    const project = detectProject(cwd);
    generateAnalyticsNextjsIntegration({
      cwd,
      dsn: `https://public@api.volato.dev/${config.projectId}`,
      ingestToken: "server-only-token",
      project,
      config,
      trackerSource,
    });
    writeFileSync(
      join(cwd, "src", "volato", "analytics", "tracker.ts"),
      "local edit",
    );

    expect(() =>
      generateAnalyticsNextjsIntegration({
        cwd,
        dsn: `https://public@api.volato.dev/${config.projectId}`,
        ingestToken: "server-only-token",
        project,
        config,
        trackerSource,
      }),
    ).toThrow(/edited or deleted/);
  });
});
