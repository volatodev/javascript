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
import { detectProject } from "../commands/init/detect";
import { generateNextjsIntegration } from "../integrations/nextjs";
import {
  ERRORS_NEXTJS_INTEGRATION,
  linkProject,
  modifiedGeneratedFiles,
  readManifest,
} from "../integrations/manifest";

const here = dirname(fileURLToPath(import.meta.url));
const sourceRoot = resolve(here, "../../skills/volato-nextjs/assets/runtime");

let cwd: string;

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), "volato-next-recipe-"));
  mkdirSync(join(cwd, "src", "app"), { recursive: true });
  writeFileSync(
    join(cwd, "package.json"),
    `${JSON.stringify(
      {
        name: "fixture",
        dependencies: {
          next: "15.5.0",
          react: "19.0.0",
        },
      },
      null,
      2,
    )}\n`,
  );
  writeFileSync(
    join(cwd, "src", "app", "layout.tsx"),
    "export default function Layout({ children }) {\n  return <body>{children}</body>;\n}\n",
  );
  writeFileSync(join(cwd, "next.config.ts"), "export default {};\n");
  linkProject(cwd, {
    id: "11111111-1111-4111-8111-111111111111",
    name: "Fixture",
  });
});

afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
});

describe("Next.js generated integration", () => {
  it("refuses to write before the repository is connected", () => {
    rmSync(join(cwd, ".volato", "manifest.json"));

    expect(() =>
      generateNextjsIntegration({
        cwd,
        dsn: "https://pk@api.volato.dev/project",
        project: detectProject(cwd),
        sourceRoot,
      }),
    ).toThrow(/volato init --project/);
    expect(existsSync(join(cwd, "src", "volato"))).toBe(false);
  });

  it("generates a local runtime without package dependencies", () => {
    const project = detectProject(cwd);
    const result = generateNextjsIntegration({
      cwd,
      dsn: "https://pk@api.volato.dev/project",
      ingestToken: "server-only-token",
      project,
      sourceRoot,
    });

    expect(result.generatedFiles.length).toBeGreaterThan(10);
    expect(existsSync(join(cwd, "src", "volato", "client.tsx"))).toBe(true);
    expect(
      readFileSync(join(cwd, "src", "app", "error.tsx"), "utf8"),
    ).toContain('from "../volato/error-boundary"');
    expect(readFileSync(project.layoutPath, "utf8")).toContain(
      'from "../volato/client"',
    );
    expect(readFileSync(project.instrumentationPath, "utf8")).toContain(
      'from "./volato/instrumentation"',
    );
    expect(readFileSync(project.nextConfigPath!, "utf8")).toContain(
      'from "./src/volato/withVolato"',
    );
    expect(
      JSON.parse(readFileSync(join(cwd, "package.json"), "utf8")).dependencies,
    ).toEqual({
      next: "15.5.0",
      react: "19.0.0",
    });
    expect(readFileSync(join(cwd, ".env.local"), "utf8")).toContain(
      "VOLATO_INGEST_TOKEN=server-only-token",
    );

    const manifest = readManifest(cwd);
    const integration = manifest?.integrations[ERRORS_NEXTJS_INTEGRATION];
    expect(integration?.recipe).toBe("errors-nextjs-app-router");
    expect(modifiedGeneratedFiles(cwd, integration!)).toEqual([]);
  });

  it("generates JavaScript and JSX runtime files for a JavaScript application", () => {
    rmSync(join(cwd, "src", "app", "layout.tsx"));
    writeFileSync(
      join(cwd, "src", "app", "layout.jsx"),
      "export default function Layout({ children }) { return <body>{children}</body>; }\n",
    );
    rmSync(join(cwd, "next.config.ts"));
    writeFileSync(join(cwd, "next.config.mjs"), "export default {};\n");
    const project = detectProject(cwd);

    const result = generateNextjsIntegration({
      cwd,
      dsn: "https://pk@api.volato.dev/project",
      project,
      sourceRoot,
    });

    expect(existsSync(join(cwd, "src", "volato", "client.jsx"))).toBe(true);
    expect(existsSync(join(cwd, "src", "volato", "server.js"))).toBe(true);
    expect(
      result.generatedFiles.some((path) => /\.(?:ts|tsx)$/.test(path)),
    ).toBe(false);
    expect(readFileSync(project.layoutPath, "utf8")).not.toContain(
      "NEXT_PUBLIC_VOLATO_DSN!",
    );
    expect(readFileSync(project.errorBoundaryPath, "utf8")).not.toContain(
      "digest?:",
    );
  });

  it("composes a Pages Router application without creating App Router files", () => {
    rmSync(join(cwd, "src", "app"), { recursive: true });
    mkdirSync(join(cwd, "src", "pages"), { recursive: true });
    writeFileSync(
      join(cwd, "src", "pages", "index.tsx"),
      "export default function Page() { return <main>Pages</main>; }\n",
    );
    const project = detectProject(cwd);

    const result = generateNextjsIntegration({
      cwd,
      dsn: "https://pk@api.volato.dev/project",
      project,
      sourceRoot,
    });

    expect(project.routerKind).toBe("pages");
    expect(existsSync(join(cwd, "src", "pages", "_app.tsx"))).toBe(true);
    expect(existsSync(join(cwd, "src", "pages", "_error.tsx"))).toBe(true);
    expect(readFileSync(project.pagesAppPath!, "utf8")).toContain(
      "<VolatoBootstrap",
    );
    expect(readFileSync(project.pagesErrorPath!, "utf8")).toContain(
      "withVolatoPagesError",
    );
    expect(existsSync(join(cwd, "src", "app"))).toBe(false);
    expect(
      result.generatedFiles.some((path) => path.endsWith("pages-error.tsx")),
    ).toBe(true);
  });

  it("is idempotent while generated files remain untouched", () => {
    const project = detectProject(cwd);
    generateNextjsIntegration({
      cwd,
      dsn: "https://pk@api.volato.dev/project",
      project,
      sourceRoot,
    });

    expect(() =>
      generateNextjsIntegration({
        cwd,
        dsn: "https://pk@api.volato.dev/project",
        project,
        sourceRoot,
      }),
    ).not.toThrow();
  });

  it("keeps Next.js 16 on Turbopack and runs the final map pass", () => {
    writeFileSync(
      join(cwd, "package.json"),
      `${JSON.stringify(
        {
          name: "fixture",
          scripts: { build: "next build" },
          dependencies: {
            next: "16.2.12",
            react: "19.2.8",
          },
        },
        null,
        2,
      )}\n`,
    );
    const project = detectProject(cwd);

    generateNextjsIntegration({
      cwd,
      dsn: "https://pk@api.volato.dev/project",
      project,
      sourceRoot,
    });

    const pkg = JSON.parse(readFileSync(join(cwd, "package.json"), "utf8")) as {
      scripts: { build: string };
    };
    expect(pkg.scripts.build).toBe(
      "next build && node ./src/volato/postbuild.cjs",
    );
    expect(pkg.scripts.build).not.toContain("--webpack");
    expect(existsSync(join(cwd, "src", "volato", "postbuild.cjs"))).toBe(true);
    expect(readFileSync(join(cwd, "next.config.ts"), "utf8")).toContain(
      "nextMajor: 16",
    );
  });

  it("refuses to overwrite a locally edited generated runtime", () => {
    const project = detectProject(cwd);
    generateNextjsIntegration({
      cwd,
      dsn: "https://pk@api.volato.dev/project",
      project,
      sourceRoot,
    });
    writeFileSync(join(cwd, "src", "volato", "client.tsx"), "local edit");

    expect(() =>
      generateNextjsIntegration({
        cwd,
        dsn: "https://pk@api.volato.dev/project",
        project,
        sourceRoot,
      }),
    ).toThrow(/were edited or deleted/);
  });
});
