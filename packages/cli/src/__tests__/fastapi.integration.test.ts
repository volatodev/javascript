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
import { generateFastApiIntegration } from "../integrations/fastapi";
import {
  ERRORS_PYTHON_FASTAPI_INTEGRATION,
  linkProject,
  modifiedGeneratedFiles,
  readManifest,
} from "../integrations/manifest";

let cwd: string;

type FixtureOptions = {
  python?: string;
  fastapi?: string;
  appSource?: string;
  dependencies?: string[];
};

function fixture(options: FixtureOptions = {}): void {
  const python = options.python ?? "3.12";
  const dependencies = options.dependencies ?? [
    `fastapi==${options.fastapi ?? "0.141.1"}`,
    "starlette==1.6.0",
    "uvicorn==0.52.4",
    "pydantic==2.13.5",
    "anyio==4.14.2",
  ];
  writeFileSync(join(cwd, ".python-version"), `${python}\n`);
  writeFileSync(
    join(cwd, "pyproject.toml"),
    `[project]\nname = "fastapi-calibration"\nrequires-python = "==${python}.*"\ndependencies = [\n${dependencies
      .map((dependency) => `  "${dependency}",`)
      .join("\n")}\n]\n`,
  );
  writeFileSync(
    join(cwd, "app.py"),
    options.appSource ??
      `from fastapi import FastAPI, HTTPException\n\napp = FastAPI()\n\n@app.get("/orders/{order_id}")\nasync def order(order_id: str):\n    raise RuntimeError("unavailable")\n`,
  );
  writeFileSync(join(cwd, ".gitignore"), ".env*.local\n__pycache__/\n.venv/\n");
}

function snapshot(root: string): Record<string, string> {
  const entries: Record<string, string> = {};
  const visit = (directory: string): void => {
    for (const name of readdirSync(directory).sort()) {
      const path = join(directory, name);
      if (statSync(path).isDirectory()) visit(path);
      else {
        entries[relative(root, path).replaceAll("\\", "/")] = readFileSync(
          path,
        ).toString("base64");
      }
    }
  };
  visit(root);
  return entries;
}

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), "volato-fastapi-"));
});

afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
});

describe("FastAPI private calibration", () => {
  it.each(["3.10", "3.11", "3.12", "3.13", "3.14"])(
    "detects the frozen Python %s HTTP cell without package.json",
    (python) => {
      fixture({ python });

      expect(detectErrorsStack(cwd).fastapi).toEqual({
        cwd,
        entryPath: join(cwd, "app.py"),
        appVariable: "app",
        pythonVersion: python,
        fastapiVersion: "0.141.1",
        starletteVersion: "1.6.0",
        uvicornVersion: "0.52.4",
        topology: "module-app",
      });
    },
  );

  it("generates dependency-free Python capture, composes last and converges", () => {
    fixture({
      appSource: `from fastapi import FastAPI, Request\n\napp = FastAPI()\n\n@app.middleware("http")\nasync def application_middleware(request: Request, call_next):\n    return await call_next(request)\n\n@app.get("/boom")\nasync def boom():\n    raise RuntimeError("boom")\n`,
    });
    linkProject(cwd, {
      id: "11111111-1111-4111-8111-111111111111",
      name: "FastAPI fixture",
    });
    const project = detectErrorsStack(cwd).fastapi!;

    const first = generateFastApiIntegration({
      cwd,
      project,
      dsn: "https://public@api.volato.dev/project",
    });

    expect(first.outcomes.every((outcome) => outcome.status !== "manual")).toBe(
      true,
    );
    for (const file of ["__init__.py", "runtime.py", "asgi.py"]) {
      expect(existsSync(join(cwd, "volato_errors", file))).toBe(true);
    }
    const app = readFileSync(join(cwd, "app.py"), "utf8");
    expect(app).toContain(
      "from volato_errors import VolatoASGIMiddleware, init_volato",
    );
    expect(app.indexOf("app.add_middleware(VolatoASGIMiddleware)")).toBeGreaterThan(
      app.indexOf("async def boom"),
    );
    expect(readFileSync(join(cwd, "pyproject.toml"), "utf8")).not.toContain(
      "volato",
    );
    expect(readFileSync(join(cwd, ".env.local"), "utf8")).toBe(
      "VOLATO_DSN=https://public@api.volato.dev/project\n",
    );
    const integration = readManifest(cwd)?.integrations[
      ERRORS_PYTHON_FASTAPI_INTEGRATION
    ];
    expect(integration?.recipe).toBe("errors-python-fastapi-private");
    expect(modifiedGeneratedFiles(cwd, integration!)).toEqual([]);

    const afterFirst = snapshot(cwd);
    const second = generateFastApiIntegration({
      cwd,
      project: detectErrorsStack(cwd).fastapi!,
      dsn: "https://public@api.volato.dev/project",
    });
    expect(second.outcomes.every((outcome) => outcome.status === "skipped")).toBe(
      true,
    );
    expect(snapshot(cwd)).toEqual(afterFirst);
  });

  it.each([
    ["Python 3.9", { python: "3.9" }, /Python 3\.9.*not supported/i],
    ["Python 3.15", { python: "3.15" }, /Python 3\.15.*not supported/i],
    ["FastAPI drift", { fastapi: "0.140.0" }, /FastAPI 0\.140\.0.*not supported/i],
    [
      "direct Starlette",
      {
        dependencies: ["starlette==1.6.0", "uvicorn==0.52.4"],
        appSource: "from starlette.applications import Starlette\napp = Starlette()\n",
      },
      /direct Starlette.*not supported/i,
    ],
    [
      "app factory",
      {
        appSource:
          "from fastapi import FastAPI\ndef create_app():\n    return FastAPI()\n",
      },
      /module-level.*app.*FastAPI/i,
    ],
    [
      "multiple apps",
      {
        appSource:
          "from fastapi import FastAPI\napp = FastAPI()\nadmin = FastAPI()\n",
      },
      /exactly one.*FastAPI/i,
    ],
    [
      "background tasks",
      {
        appSource:
          "from fastapi import BackgroundTasks, FastAPI\napp = FastAPI()\n",
      },
      /background-task.*not supported/i,
    ],
    [
      "websocket",
      { appSource: "from fastapi import FastAPI, WebSocket\napp = FastAPI()\n" },
      /WebSocket.*not supported/i,
    ],
    [
      "streaming",
      {
        appSource:
          "from fastapi import FastAPI\nfrom starlette.responses import StreamingResponse\napp = FastAPI()\n",
      },
      /streaming.*not supported/i,
    ],
    [
      "lifespan",
      {
        appSource:
          "from fastapi import FastAPI\nasync def lifespan(app):\n    yield\napp = FastAPI(lifespan=lifespan)\n",
      },
      /lifespan.*not supported/i,
    ],
  ] as const)("refuses %s before changing one byte", (_label, options, expected) => {
    fixture(options);
    const before = snapshot(cwd);

    expect(() => detectErrorsStack(cwd)).toThrowError(expected);
    expect(snapshot(cwd)).toEqual(before);
  });

  it("refuses edited generated Python files without changing the repository", () => {
    fixture();
    linkProject(cwd, {
      id: "11111111-1111-4111-8111-111111111111",
      name: "FastAPI fixture",
    });
    generateFastApiIntegration({
      cwd,
      project: detectErrorsStack(cwd).fastapi!,
      dsn: "https://public@api.volato.dev/project",
    });
    writeFileSync(join(cwd, "volato_errors", "runtime.py"), "# edited\n");
    const before = snapshot(cwd);

    expect(() =>
      generateFastApiIntegration({
        cwd,
        project: detectErrorsStack(cwd).fastapi!,
        dsn: "https://public@api.volato.dev/project",
      }),
    ).toThrowError(/edited or deleted/i);
    expect(snapshot(cwd)).toEqual(before);
  });
});
