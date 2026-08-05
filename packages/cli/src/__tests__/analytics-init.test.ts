import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { linkProject } from "../integrations/manifest";

const fetchProjectSetup = vi.fn();
const assertAnalyticsNextjsWritable = vi.fn();
const generateAnalyticsNextjsIntegration = vi.fn();

vi.mock("../commands/init/project-setup.js", () => ({
  fetchProjectSetup: (projectId: string) => fetchProjectSetup(projectId),
}));
vi.mock("../integrations/analytics-nextjs.js", () => ({
  assertAnalyticsNextjsWritable: (cwd: string) =>
    assertAnalyticsNextjsWritable(cwd),
  generateAnalyticsNextjsIntegration: (options: unknown) =>
    generateAnalyticsNextjsIntegration(options),
}));

const { runAnalyticsInit } = await import("../commands/init/analytics.js");

const projectId = "11111111-1111-4111-8111-111111111111";
const config = {
  schemaVersion: 1,
  projectId,
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
};

let cwd: string;

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), "volato-analytics-init-"));
  mkdirSync(join(cwd, "app"), { recursive: true });
  writeFileSync(
    join(cwd, "package.json"),
    JSON.stringify({
      name: "fixture",
      dependencies: { next: "16.2.12", react: "19.2.8" },
    }),
  );
  writeFileSync(
    join(cwd, "app", "layout.tsx"),
    "export default function Layout({ children }) { return <html><body>{children}</body></html>; }\n",
  );
  writeFileSync(join(cwd, "next.config.ts"), "export default {};\n");
  linkProject(cwd, { id: projectId, name: "Checkout" });
  writeFileSync(
    join(cwd, ".volato", "analytics.json"),
    `${JSON.stringify(config)}\n`,
  );
  writeFileSync(join(cwd, ".gitignore"), ".env*.local\n");
  vi.stubEnv("VOLATO_API_URL", "https://api.test.local");
  vi.stubEnv("VOLATO_TOKEN", "workspace-token");
  fetchProjectSetup.mockReset();
  fetchProjectSetup.mockResolvedValue({
    projectId,
    projectName: "Checkout",
    dsn: `https://public@api.volato.dev/${projectId}`,
    ingestToken: "server-only-token",
  });
  assertAnalyticsNextjsWritable.mockReset();
  generateAnalyticsNextjsIntegration.mockReset();
  vi.spyOn(process.stdout, "write").mockImplementation(() => true);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  rmSync(cwd, { recursive: true, force: true });
});

describe("volato analytics init", () => {
  it("checks generated ownership before publishing the contract", async () => {
    assertAnalyticsNextjsWritable.mockImplementation(() => {
      throw new Error("generated file edited");
    });
    const fetchMock = vi.spyOn(globalThis, "fetch");

    await expect(
      runAnalyticsInit({ cwd, nonInteractive: true }),
    ).rejects.toThrow("generated file edited");

    expect(fetchMock).not.toHaveBeenCalled();
    expect(generateAnalyticsNextjsIntegration).not.toHaveBeenCalled();
  });
});
