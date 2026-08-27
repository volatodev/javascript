import { createRequire } from "node:module";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runtimeMatrix } from "./errors-runtime-matrix.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const bundlePath = resolve(
  repositoryRoot,
  "packages/cli/.documentation-build/contract.cjs",
);

if (!existsSync(bundlePath)) {
  throw new Error(
    "Missing documentation contract bundle. Run `pnpm --filter @volatodev/cli docs:bundle` first.",
  );
}

const args = process.argv.slice(2);
let check = false;
let outputPath = resolve(
  repositoryRoot,
  "generated/documentation-contract.json",
);
for (let index = 0; index < args.length; index += 1) {
  const argument = args[index];
  if (argument === "--check") {
    check = true;
    continue;
  }
  if (argument === "--output") {
    const value = args[index + 1];
    if (!value) throw new Error("--output requires a path");
    outputPath = resolve(process.cwd(), value);
    index += 1;
    continue;
  }
  throw new Error(`Unknown documentation generation option: ${argument}`);
}

const require = createRequire(import.meta.url);
const { buildDocumentationContract } = require(bundlePath);
const expected = `${JSON.stringify(buildDocumentationContract(runtimeMatrix), null, 2)}\n`;

if (check) {
  const current = existsSync(outputPath)
    ? readFileSync(outputPath, "utf8")
    : null;
  if (current !== expected) {
    throw new Error(
      `Documentation contract is stale: ${outputPath}. Run \`pnpm docs:generate\`.`,
    );
  }
  process.stdout.write(`Documentation contract is current: ${outputPath}\n`);
} else {
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, expected, "utf8");
  process.stdout.write(`Generated documentation contract: ${outputPath}\n`);
}
