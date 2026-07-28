import { readFile } from "node:fs/promises";

const [, , expectedVersion, publishedVersionsPath] = process.argv;
const packageJsonPath = new URL("../packages/cli/package.json", import.meta.url);
const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));
const betaVersionPattern = /^\d+\.\d+\.\d+-beta\.\d+$/;

if (!expectedVersion) {
  throw new Error("Expected beta version is required.");
}

if (!betaVersionPattern.test(expectedVersion)) {
  throw new Error(
    `Invalid beta version "${expectedVersion}". Expected a version like 0.1.0-beta.1.`,
  );
}

if (packageJson.version !== expectedVersion) {
  throw new Error(
    `Release input "${expectedVersion}" does not match packages/cli/package.json "${packageJson.version}".`,
  );
}

if (publishedVersionsPath) {
  const publishedValue = JSON.parse(
    await readFile(publishedVersionsPath, "utf8"),
  );
  const publishedVersions = Array.isArray(publishedValue)
    ? publishedValue
    : [publishedValue];

  if (publishedVersions.includes(expectedVersion)) {
    throw new Error(
      `@volatodev/cli@${expectedVersion} is already published. Published versions are immutable.`,
    );
  }
}

console.log(`Validated @volatodev/cli@${expectedVersion} for beta publication.`);
