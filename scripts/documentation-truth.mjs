import {
  existsSync,
  readFileSync,
  readdirSync,
} from "node:fs";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const forbiddenPatterns = [
  {
    label: "dashboard error-list promise",
    pattern: /dashboard\s+(?:will\s+)?surface(?:s|d)?\s+the\s+first\s+production\s+error/i,
  },
  {
    label: "unsupported self-hosting promise",
    pattern: /self[- ]host(?:ed|ing)?/i,
  },
  {
    label: "global JSON promise",
    pattern: /(?:all|every)\s+commands?.{0,40}--json|--json.{0,40}(?:all|every)\s+commands?/i,
  },
];

const defaultSupportMarkers = {
  "browser-react": "React 18/19",
  "browser-vue": "Vue 3",
  "browser-svelte": "Svelte 5",
  "node-long-lived": "Node 22/24",
  express: "Express 4/5",
  fastify: "Fastify 5",
  "nest-http": "NestJS 11/12",
  "node-invocation": "provider-neutral",
};

function headingSlug(value) {
  return value
    .toLowerCase()
    .replaceAll("`", "")
    .replace(/<[^>]*>/g, "")
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/[\s-]+/g, "-");
}

function anchors(markdown) {
  const counts = new Map();
  const result = new Set();
  for (const match of markdown.matchAll(/^#{1,6}\s+(.+)$/gm)) {
    const base = headingSlug(match[1]);
    const count = counts.get(base) ?? 0;
    counts.set(base, count + 1);
    result.add(count === 0 ? base : `${base}-${count}`);
  }
  return result;
}

function tokens(command) {
  return command.match(/"[^"]*"|'[^']*'|\S+/g) ?? [];
}

function documentedCommands(markdown) {
  return markdown
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("volato "))
    .map((line) => line.split(/\s+#/)[0].trim());
}

function verifyCliCommand(command, contract) {
  const commandTokens = tokens(command);
  const definitions = contract.cli.commands
    .filter(({ path }) =>
      path.every((part, index) => commandTokens[index] === part),
    )
    .sort((left, right) => right.path.length - left.path.length);
  const definition = definitions[0];
  if (!definition) return `unknown CLI command: ${command}`;

  const children = contract.cli.commands.filter(
    ({ path }) =>
      path.length > definition.path.length &&
      definition.path.every((part, index) => path[index] === part),
  );
  const tail = commandTokens.slice(definition.path.length);
  if (
    children.length > 0 &&
    tail[0] &&
    !tail[0].startsWith("-") &&
    !tail[0].startsWith("<") &&
    !tail[0].startsWith("[")
  ) {
    return `unknown CLI command: ${command}`;
  }

  const allowed = new Set(
    [...(contract.cli.options ?? []), ...(definition.options ?? [])].flatMap(
      ({ long, short }) => [long, short].filter(Boolean),
    ),
  );
  for (const token of tail) {
    if (!token.startsWith("-")) continue;
    const option = token.split("=")[0];
    if (!allowed.has(option)) {
      return `unknown CLI option ${option} in: ${command}`;
    }
  }
  return null;
}

export function verifyDocumentationTruth({
  documents,
  contract,
  supportMarkers = defaultSupportMarkers,
  pathExists = (path) => documents.has(path),
}) {
  const errors = [];
  const allText = [...documents.values()].join("\n");

  for (const [filePath, markdown] of documents) {
    for (const { label, pattern } of forbiddenPatterns) {
      if (pattern.test(markdown)) errors.push(`${filePath}: forbidden promise (${label})`);
    }

    for (const match of markdown.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
      const href = match[1].trim();
      if (/^(?:https?:|mailto:)/.test(href)) continue;
      const [rawTarget, rawFragment] = href.split("#", 2);
      const target = rawTarget
        ? resolve(dirname(filePath), decodeURIComponent(rawTarget))
        : filePath;
      if (!pathExists(target)) {
        errors.push(`${filePath}: missing link target ${href}`);
        continue;
      }
      if (rawFragment && extname(target).toLowerCase() === ".md") {
        const targetMarkdown = documents.get(target);
        if (targetMarkdown && !anchors(targetMarkdown).has(decodeURIComponent(rawFragment))) {
          errors.push(`${filePath}: missing anchor ${href}`);
        }
      }
    }

    for (const command of documentedCommands(markdown)) {
      const error = verifyCliCommand(command, contract);
      if (error) errors.push(`${filePath}: ${error}`);
    }
  }

  for (const [family, marker] of Object.entries(supportMarkers)) {
    if (!Object.hasOwn(contract.support.families, family)) {
      errors.push(`support authority is missing expected family ${family}`);
    } else if (!allText.includes(marker)) {
      errors.push(`missing support claim for ${family}: ${marker}`);
    }
  }

  return errors;
}

function markdownFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return markdownFiles(path);
    return entry.isFile() && entry.name.endsWith(".md") ? [path] : [];
  });
}

function run() {
  const controlled = [
    resolve(repositoryRoot, "README.md"),
    resolve(repositoryRoot, "packages/cli/README.md"),
    ...markdownFiles(resolve(repositoryRoot, "packages/cli/skills")),
  ];
  const documents = new Map(
    controlled.map((path) => [path, readFileSync(path, "utf8")]),
  );
  const contract = JSON.parse(
    readFileSync(
      resolve(repositoryRoot, "generated/documentation-contract.json"),
      "utf8",
    ),
  );
  const errors = verifyDocumentationTruth({
    documents,
    contract,
    pathExists: existsSync,
  });
  if (errors.length > 0) {
    process.stderr.write(`${errors.join("\n")}\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write(
    `JavaScript documentation truth passed (${documents.size} files, ${contract.support.totalCells} support cells).\n`,
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  run();
}
