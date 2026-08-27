import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { verifyDocumentationTruth } from "./documentation-truth.mjs";

const contract = {
  cli: {
    commands: [
      {
        path: ["volato", "errors", "show"],
        options: [{ long: "--json", short: null }],
      },
    ],
    options: [],
  },
  support: {
    totalCells: 2,
    families: { "browser-react": [{}], "node-long-lived": [{}] },
  },
};

const cleanDocuments = new Map([
  [
    "/repo/README.md",
    [
      "# Guide",
      "",
      "[Details](./details.md#proof)",
      "",
      "```sh",
      "volato errors show --json",
      "```",
      "",
      "React 18/19 and Node 22/24 are supported.",
    ].join("\n"),
  ],
  ["/repo/details.md", "# Details\n\n## Proof\n"],
]);

test("accepts a linked, executable and matrix-backed corpus", () => {
  assert.deepEqual(
    verifyDocumentationTruth({
      documents: cleanDocuments,
      contract,
      supportMarkers: {
        "browser-react": "React 18/19",
        "node-long-lived": "Node 22/24",
      },
    }),
    [],
  );
});

test("rejects each documentation drift family", () => {
  const cases = [
    {
      name: "broken link",
      documents: new Map([
        ...cleanDocuments,
        ["/repo/README.md", "# Guide\n\n[Missing](./missing.md)\nReact 18/19 Node 22/24"],
      ]),
      expected: "missing link target",
    },
    {
      name: "broken anchor",
      documents: new Map([
        ...cleanDocuments,
        ["/repo/README.md", "# Guide\n\n[Bad](./details.md#absent)\nReact 18/19 Node 22/24"],
      ]),
      expected: "missing anchor",
    },
    {
      name: "forbidden promise",
      documents: new Map([
        ...cleanDocuments,
        ["/repo/README.md", "# Guide\n\nThe dashboard will surface the first production error.\nReact 18/19 Node 22/24"],
      ]),
      expected: "forbidden promise",
    },
    {
      name: "invented CLI option",
      documents: new Map([
        ...cleanDocuments,
        ["/repo/README.md", "# Guide\n\n```sh\nvolato errors show --invented\n```\nReact 18/19 Node 22/24"],
      ]),
      expected: "unknown CLI option",
    },
    {
      name: "missing support family",
      documents: new Map([
        ...cleanDocuments,
        ["/repo/README.md", "# Guide\n\nReact 18/19"],
      ]),
      expected: "missing support claim",
    },
  ];

  for (const fixture of cases) {
    const errors = verifyDocumentationTruth({
      documents: fixture.documents,
      contract,
      supportMarkers: {
        "browser-react": "React 18/19",
        "node-long-lived": "Node 22/24",
      },
    });
    assert.ok(
      errors.some((error) => error.includes(fixture.expected)),
      `${fixture.name}: ${errors.join("\n")}`,
    );
  }
});

test("skills refuse premature resolution and name exact verification primitives", () => {
  const setup = readFileSync(
    new URL("../packages/cli/skills/volato-setup/SKILL.md", import.meta.url),
    "utf8",
  );
  const errors = readFileSync(
    new URL("../packages/cli/skills/volato-errors/SKILL.md", import.meta.url),
    "utf8",
  );
  const browser = readFileSync(
    new URL("../packages/cli/skills/volato-vite-react/SKILL.md", import.meta.url),
    "utf8",
  );
  const normalizedSetup = setup.replace(/\s+/g, " ");
  const normalizedErrors = errors.replace(/\s+/g, " ");
  const normalizedBrowser = browser.replace(/\s+/g, " ");

  assert.match(normalizedSetup, /There is no `volato errors verify` command/);
  assert.match(normalizedSetup, /`volato errors show --json`/);
  assert.match(
    normalizedErrors,
    /An explicit request to resolve starts this verification; it does not replace it/,
  );
  assert.doesNotMatch(
    normalizedErrors,
    /sufficient evidence or an explicit user instruction/,
  );
  for (const exclusion of [
    "cookies",
    "request or response bodies",
    "arbitrary headers",
    "query values",
    "arbitrary user payloads",
  ]) {
    assert.match(normalizedBrowser, new RegExp(exclusion));
  }
});
