import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";

const packageJsonPath = new URL("../packages/cli/package.json", import.meta.url);
const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));
const betaVersionPattern = /^\d+\.\d+\.\d+-beta\.\d+$/;

if (!betaVersionPattern.test(packageJson.version)) {
  throw new Error(
    `Refusing to move alpha dist-tags to non-beta version "${packageJson.version}".`,
  );
}

execFileSync(
  "npm",
  ["dist-tag", "add", `${packageJson.name}@${packageJson.version}`, "latest"],
  { stdio: "inherit" },
);
