import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { detectErrorsStack } from "../commands/init/detect-errors";
import { generateAngularIntegration } from "../integrations/angular";
import {
  ERRORS_BROWSER_ANGULAR_INTEGRATION,
  linkProject,
  modifiedGeneratedFiles,
  readManifest,
} from "../integrations/manifest";

let cwd: string;

type AngularFixtureOptions = {
  angular?: string;
  build?: string;
  builder?: string;
  changeDetection?: "zone" | "zoneless";
  configSource?: string;
  extraDependencies?: Record<string, string>;
  mainSource?: string;
  mutateAngular?: (workspace: Record<string, unknown>) => void;
  projects?: number;
};

function fixture(options: AngularFixtureOptions = {}): void {
  const angular = options.angular ?? "22.1.0";
  const major = Number(angular.split(".")[0]);
  const changeDetection = options.changeDetection ?? (major === 20 ? "zone" : "zoneless");
  mkdirSync(join(cwd, "src", "app"), { recursive: true });
  const dependencies: Record<string, string> = {
    "@angular/common": angular,
    "@angular/compiler": angular,
    "@angular/core": angular,
    "@angular/platform-browser": angular,
    rxjs: "7.8.2",
    tslib: "2.8.1",
    ...(changeDetection === "zone" ? { "zone.js": "0.15.1" } : {}),
    ...options.extraDependencies,
  };
  const buildVersions: Record<number, string> = {
    20: "20.3.35",
    21: "21.2.22",
    22: "22.1.6",
  };
  writeFileSync(
    join(cwd, "package.json"),
    `${JSON.stringify({
      name: "angular-calibration-fixture",
      private: true,
      scripts: { build: options.build ?? "ng build" },
      dependencies,
      devDependencies: {
        "@angular/build": buildVersions[major] ?? "19.2.19",
        "@angular/cli": buildVersions[major] ?? "19.2.19",
        "@angular/compiler-cli": angular,
        typescript: major >= 22 ? "6.0.2" : "5.9.2",
      },
    }, null, 2)}\n`,
  );
  const projects = Object.fromEntries(
    Array.from({ length: options.projects ?? 1 }, (_, index) => {
      const name = index === 0 ? "calibration-app" : `admin-${index}`;
      return [
        name,
        {
          projectType: "application",
          root: index === 0 ? "" : `projects/${name}`,
          sourceRoot: index === 0 ? "src" : `projects/${name}/src`,
          architect: {
            build: {
              builder: options.builder ?? "@angular/build:application",
              options: {
                browser: index === 0 ? "src/main.ts" : `projects/${name}/src/main.ts`,
                tsConfig: index === 0 ? "tsconfig.app.json" : `projects/${name}/tsconfig.app.json`,
                ...(changeDetection === "zone" ? { polyfills: ["zone.js"] } : {}),
              },
              configurations: {
                production: { outputHashing: "all" },
                development: { optimization: false, sourceMap: true },
              },
              defaultConfiguration: "production",
            },
          },
        },
      ];
    }),
  );
  const workspace: Record<string, unknown> = {
    version: 1,
    projects,
  };
  options.mutateAngular?.(workspace);
  writeFileSync(join(cwd, "angular.json"), `${JSON.stringify(workspace, null, 2)}\n`);
  writeFileSync(
    join(cwd, "src", "main.ts"),
    options.mainSource ??
      `import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { App } from './app/app';

bootstrapApplication(App, appConfig).catch((error) => console.error(error));
`,
  );
  writeFileSync(
    join(cwd, "src", "app", "app.config.ts"),
    options.configSource ??
      `import { ApplicationConfig, ErrorHandler, provideBrowserGlobalErrorListeners${changeDetection === "zoneless" && major === 20 ? ", provideZonelessChangeDetection" : ""} } from '@angular/core';
import { provideRouter } from '@angular/router';

class ExistingErrorHandler implements ErrorHandler {
  handleError(error: unknown): void { console.error('application-owned', error); }
}

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    ${changeDetection === "zoneless" && major === 20 ? "provideZonelessChangeDetection(),\n    " : ""}{ provide: ErrorHandler, useClass: ExistingErrorHandler },
    provideRouter([]),
  ],
};
`,
  );
  writeFileSync(join(cwd, "src", "app", "app.ts"), "export class App {}\n");
  writeFileSync(join(cwd, "tsconfig.app.json"), '{"compilerOptions":{"target":"ES2022"},"files":["src/main.ts"]}\n');
  writeFileSync(join(cwd, ".gitignore"), "node_modules/\ndist/\n.env*.local\n");
}

function snapshot(root: string): Record<string, string> {
  const entries: Record<string, string> = {};
  const visit = (directory: string): void => {
    for (const name of readdirSync(directory).sort()) {
      const path = join(directory, name);
      if (statSync(path).isDirectory()) visit(path);
      else entries[relative(root, path).replaceAll("\\", "/")] = readFileSync(path).toString("base64");
    }
  };
  visit(root);
  return entries;
}

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), "volato-angular-"));
});

afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
});

describe("Angular private calibration", () => {
  it.each([
    ["20 Zone.js", { angular: "20.3.0", changeDetection: "zone" }, "zonejs"],
    ["20 zoneless", { angular: "20.3.0", changeDetection: "zoneless" }, "zoneless"],
    ["21 default zoneless", { angular: "21.2.0", changeDetection: "zoneless" }, "zoneless"],
    ["22 default zoneless", { angular: "22.1.0", changeDetection: "zoneless" }, "zoneless"],
  ] as const)("detects the frozen Angular %s cell", (_label, options, expectedMode) => {
    fixture(options);

    expect(detectErrorsStack(cwd).angular).toMatchObject({
      projectName: "calibration-app",
      entryPath: join(cwd, "src", "main.ts"),
      appConfigPath: join(cwd, "src", "app", "app.config.ts"),
      angularConfigPath: join(cwd, "angular.json"),
      angularVersion: Number(options.angular.split(".")[0]),
      buildAdapter: "angular",
      changeDetection: expectedMode,
      outputRoot: join(cwd, "dist", "calibration-app"),
    });
  });

  it("generates a dependency-free Angular composition and converges", () => {
    fixture();
    linkProject(cwd, {
      id: "11111111-1111-4111-8111-111111111111",
      name: "Angular fixture",
    });
    const project = detectErrorsStack(cwd).angular!;

    const first = generateAngularIntegration({
      cwd,
      project,
      dsn: "https://public@api.volato.dev/project",
      ingestToken: "private-upload-token",
    });

    expect(first.outcomes.every((outcome) => outcome.status !== "manual")).toBe(true);
    for (const file of ["browser.ts", "angular.ts", "artifact.mjs", "angular-build.mjs"]) {
      expect(existsSync(join(cwd, "src", "volato", file))).toBe(true);
    }
    const config = readFileSync(project.appConfigPath, "utf8");
    expect(config).toContain('import { provideVolatoAngular } from "../volato/angular";');
    expect(config.indexOf("provideVolatoAngular()"))
      .toBeLessThan(config.indexOf("provideBrowserGlobalErrorListeners()"));
    expect(config).toContain("useClass: ExistingErrorHandler");
    const pkg = JSON.parse(readFileSync(join(cwd, "package.json"), "utf8"));
    expect(pkg.scripts.build).toBe("node src/volato/angular-build.mjs");
    const workspace = JSON.parse(readFileSync(join(cwd, "angular.json"), "utf8"));
    expect(workspace.projects[project.projectName].architect.build.configurations.production.sourceMap)
      .toEqual({ scripts: true, styles: false, hidden: true, sourcesContent: true });
    expect(readFileSync(join(cwd, ".env.local"), "utf8")).toContain(
      "VOLATO_DSN=https://public@api.volato.dev/project",
    );
    expect(readFileSync(join(cwd, ".env.local"), "utf8")).toContain(
      "VOLATO_INGEST_TOKEN=private-upload-token",
    );
    const integration = readManifest(cwd)?.integrations[
      ERRORS_BROWSER_ANGULAR_INTEGRATION
    ];
    expect(integration?.recipe).toBe("errors-browser-angular-private");
    expect(modifiedGeneratedFiles(cwd, integration!)).toEqual([]);

    const afterFirst = snapshot(cwd);
    const second = generateAngularIntegration({
      cwd,
      project: detectErrorsStack(cwd).angular!,
      dsn: "https://public@api.volato.dev/project",
      ingestToken: "private-upload-token",
    });
    expect(second.outcomes.every((outcome) => outcome.status === "skipped")).toBe(true);
    expect(snapshot(cwd)).toEqual(afterFirst);
  });

  it.each([
    ["Angular 19", { angular: "19.2.0" }, /Angular 19.*not supported/i],
    ["multiple projects", { projects: 2 }, /exactly one application project/i],
    ["SSR dependency", { extraDependencies: { "@angular/ssr": "22.1.0" } }, /SSR.*not supported/i],
    ["custom builder", { builder: "@custom/build:application" }, /builder.*not supported/i],
    ["custom build script", { build: "node scripts/build.mjs" }, /build script.*ng build/i],
    ["NgModule bootstrap", { mainSource: "platformBrowserDynamic().bootstrapModule(AppModule);\n" }, /bootstrapApplication/i],
    ["Angular 22 Zone.js", { angular: "22.1.0", changeDetection: "zone" }, /Angular 22.*Zone\.js.*not supported/i],
    [
      "custom output path",
      {
        mutateAngular: (workspace: Record<string, any>) => {
          workspace.projects["calibration-app"].architect.build.options.outputPath = "build/client";
        },
      },
      /custom outputPath.*not supported/i,
    ],
    [
      "hydration",
      {
        configSource:
          "import { provideClientHydration } from '@angular/platform-browser';\nexport const appConfig = { providers: [provideClientHydration()] };\n",
      },
      /hydration.*not supported/i,
    ],
  ] as const)("refuses %s before changing one byte", (_label, options, expected) => {
    fixture(options);
    const before = snapshot(cwd);

    expect(() => detectErrorsStack(cwd)).toThrowError(expected);
    expect(snapshot(cwd)).toEqual(before);
  });

  it("refuses edited generated Angular files without changing the repository", () => {
    fixture();
    linkProject(cwd, {
      id: "11111111-1111-4111-8111-111111111111",
      name: "Angular fixture",
    });
    generateAngularIntegration({
      cwd,
      project: detectErrorsStack(cwd).angular!,
      dsn: "https://public@api.volato.dev/project",
    });
    writeFileSync(join(cwd, "src", "volato", "angular.ts"), "// edited\n");
    const before = snapshot(cwd);

    expect(() =>
      generateAngularIntegration({
        cwd,
        project: detectErrorsStack(cwd).angular!,
        dsn: "https://public@api.volato.dev/project",
      }),
    ).toThrowError(/edited or deleted/i);
    expect(snapshot(cwd)).toEqual(before);
  });
});
