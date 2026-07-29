import { spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cli = join(repositoryRoot, "packages", "cli", "dist", "cli.cjs");
const scratch = mkdtempSync(join(tmpdir(), "volato-nextjs-conformance-"));
const AUTH_TOKEN = "conformance-agent-token";
const INGEST_TOKEN = "conformance-ingest-token";
const MATRIX = [
  { label: "Next.js 15", next: "15.5.22", react: "19.2.8" },
  { label: "Next.js 16", next: "16.2.12", react: "19.2.8" },
];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function run(command, args, options = {}) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? repositoryRoot,
      env: { ...process.env, ...options.env, NO_COLOR: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", rejectRun);
    child.on("close", (status) => {
      if (status !== 0) {
        rejectRun(
          new Error(
            `${command} ${args.join(" ")} failed (${status})\n${stdout}\n${stderr}`,
          ),
        );
        return;
      }
      resolveRun({ stdout, stderr });
    });
  });
}

function writeFixture(root, entry) {
  mkdirSync(join(root, "app"), { recursive: true });
  writeFileSync(
    join(root, "package.json"),
    `${JSON.stringify(
      {
        name: `volato-${entry.next.replaceAll(".", "-")}-conformance`,
        private: true,
        scripts: { build: "next build" },
        dependencies: {
          next: entry.next,
          react: entry.react,
          "react-dom": entry.react,
        },
        devDependencies: {
          "@types/node": "24.10.0",
          "@types/react": "19.2.17",
          "@types/react-dom": "19.2.3",
          typescript: "5.9.3",
        },
      },
      null,
      2,
    )}\n`,
  );
  writeFileSync(
    join(root, "app", "layout.tsx"),
    `export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
`,
  );
  writeFileSync(
    join(root, "app", "page.tsx"),
    `export default function Page() {
  return <main>Volato conformance</main>;
}
`,
  );
  writeFileSync(join(root, "next.config.ts"), "export default {};\n");
}

const state = {
  testEvents: 0,
  sourcemaps: 0,
};

const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  const setupMatch = url.pathname.match(
    /^\/v1\/projects\/([0-9a-f-]+)\/setup$/,
  );
  if (req.method === "GET" && setupMatch) {
    if (req.headers.authorization !== `Bearer ${AUTH_TOKEN}`) {
      res.writeHead(401, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "invalid_token" }));
      return;
    }
    const projectId = setupMatch[1];
    const origin = `http://127.0.0.1:${server.address().port}`;
    res.writeHead(200, {
      "content-type": "application/json",
      "cache-control": "no-store",
    });
    res.end(
      JSON.stringify({
        data: {
          projectId,
          projectName: "Conformance",
          dsn: `http://public@127.0.0.1:${server.address().port}/${projectId}`,
          ingestToken: INGEST_TOKEN,
        },
      }),
    );
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/ingest") {
    state.testEvents += 1;
    req.resume();
    res.writeHead(202, { "content-type": "application/json" });
    res.end(JSON.stringify({ accepted: true }));
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/sourcemaps") {
    if (req.headers.authorization !== `Bearer ${INGEST_TOKEN}`) {
      res.writeHead(401);
      res.end();
      return;
    }
    state.sourcemaps += 1;
    req.resume();
    res.writeHead(201, { "content-type": "application/json" });
    res.end(JSON.stringify({ stored: true }));
    return;
  }
  res.writeHead(404);
  res.end();
});

try {
  assert(existsSync(cli), "CLI is not built; run the smoke through pnpm.");
  await new Promise((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const address = server.address();
  assert(address && typeof address === "object", "Mock API did not bind.");
  const apiOrigin = `http://127.0.0.1:${address.port}`;

  for (const [index, entry] of MATRIX.entries()) {
    const fixture = join(scratch, `next-${entry.next}`);
    const projectId = `00000000-0000-4000-8000-00000000000${index + 1}`;
    writeFixture(fixture, entry);

    await run("pnpm", ["install", "--ignore-scripts"], { cwd: fixture });
    const beforeEvents = state.testEvents;
    const init = await run(
      process.execPath,
      [
        cli,
        "init",
        "--project",
        projectId,
        "--yes",
        "--send-test-event",
      ],
      {
        cwd: fixture,
        env: {
          VOLATO_API_URL: apiOrigin,
          VOLATO_TOKEN: AUTH_TOKEN,
        },
      },
    );

    assert(
      state.testEvents === beforeEvents + 1,
      `${entry.label} setup did not send its test event.`,
    );
    assert(
      !`${init.stdout}${init.stderr}`.includes(INGEST_TOKEN),
      `${entry.label} setup printed the ingest token.`,
    );
    for (const required of [
      ".agents/skills/volato-setup/SKILL.md",
      ".agents/skills/volato-nextjs/SKILL.md",
      ".volato/manifest.json",
      ".env.local",
      ".gitignore",
      "app/error.tsx",
      "instrumentation.ts",
      "volato/server.ts",
    ]) {
      assert(
        existsSync(join(fixture, required)),
        `${entry.label} setup did not create ${required}.`,
      );
    }
    const envLocal = readFileSync(join(fixture, ".env.local"), "utf8");
    assert(
      envLocal.includes("NEXT_PUBLIC_VOLATO_DSN=") &&
        envLocal.includes(`VOLATO_INGEST_TOKEN=${INGEST_TOKEN}`),
      `${entry.label} setup did not write both credentials.`,
    );
    assert(
      readFileSync(join(fixture, ".gitignore"), "utf8").includes(
        ".env*.local",
      ),
      `${entry.label} setup did not protect local credentials.`,
    );

    const beforeMaps = state.sourcemaps;
    await run("pnpm", ["build"], {
      cwd: fixture,
      env: { VOLATO_RELEASE: `conformance-next-${entry.next}` },
    });
    assert(
      state.sourcemaps > beforeMaps,
      `${entry.label} build uploaded no sourcemaps.`,
    );
    process.stdout.write(
      `✓ ${entry.label} ${entry.next}: authenticated init + production build\n`,
    );
  }
} finally {
  await new Promise((resolveClose) => server.close(resolveClose));
  rmSync(scratch, { recursive: true, force: true });
}
