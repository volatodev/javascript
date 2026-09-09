import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const marketplacePath = join(
  repositoryRoot,
  ".cursor-plugin",
  "marketplace.json",
);

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function assertRelativePath(path, label) {
  assert.equal(path.startsWith("/"), false, `${label} must be relative`);
  assert.equal(
    path.split("/").includes(".."),
    false,
    `${label} must not traverse outside the repository`,
  );
}

test("indexes the portable Volato plugin from the Cursor marketplace root", () => {
  const marketplace = readJson(marketplacePath);
  assert.equal(marketplace.name, "volato");
  assert.equal(marketplace.owner.name, "Wrenchy SASU");
  assert.equal(marketplace.plugins.length, 1);

  const entry = marketplace.plugins[0];
  assert.equal(entry.name, "volato");
  assertRelativePath(entry.source, "plugin source");
  assertRelativePath(entry.logo, "plugin logo");

  const pluginRoot = resolve(repositoryRoot, entry.source);
  assert.ok(
    pluginRoot.startsWith(`${repositoryRoot}/`),
    "plugin source must stay inside the repository",
  );
  assert.ok(existsSync(join(pluginRoot, "plugin.json")));
  assert.ok(existsSync(join(pluginRoot, "mcp.json")));
  assert.ok(existsSync(resolve(repositoryRoot, entry.logo)));
  assert.ok(existsSync(join(pluginRoot, "README.md")));

  const skills = readdirSync(join(pluginRoot, "skills"), {
    withFileTypes: true,
  })
    .filter((candidate) => candidate.isDirectory())
    .map((candidate) => candidate.name);
  for (const required of ["volato-errors", "volato-setup"]) {
    assert.ok(skills.includes(required), `plugin is missing ${required}`);
    assert.ok(existsSync(join(pluginRoot, "skills", required, "SKILL.md")));
  }
});

test("documents a Cursor-compatible local plugin copy", () => {
  const readme = readFileSync(
    join(repositoryRoot, "packages", "cli", "README.md"),
    "utf8",
  );
  assert.match(readme, /cp -R packages\/cli\/plugin\.json/);
  assert.doesNotMatch(readme, /ln -s/);
});

test("keeps Cursor, Agent Plugins and Claude metadata aligned", () => {
  const marketplace = readJson(marketplacePath);
  const entry = marketplace.plugins[0];
  const pluginRoot = resolve(repositoryRoot, entry.source);
  const portable = readJson(join(pluginRoot, "plugin.json"));
  const claude = readJson(
    join(pluginRoot, ".claude-plugin", "plugin.json"),
  );

  assert.deepEqual(Object.keys(portable).sort(), [
    "$schema",
    "author",
    "description",
    "homepage",
    "keywords",
    "license",
    "name",
    "repository",
    "version",
  ]);
  assert.equal(
    portable.$schema,
    "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json",
  );
  for (const field of [
    "name",
    "version",
    "description",
    "homepage",
    "repository",
    "license",
  ]) {
    assert.equal(entry[field], portable[field], `${field} differs from index`);
    assert.equal(
      claude[field],
      portable[field],
      `${field} differs from Claude plugin`,
    );
  }
  assert.deepEqual(entry.keywords, portable.keywords);
  assert.deepEqual(claude.keywords, portable.keywords);
  assert.equal(entry.author.name, portable.author.name);
  assert.equal(claude.author.name, portable.author.name);
});

test("declares one credential-free Streamable HTTP MCP connection", () => {
  const marketplace = readJson(marketplacePath);
  const pluginRoot = resolve(repositoryRoot, marketplace.plugins[0].source);
  const portable = readJson(join(pluginRoot, "mcp.json"));
  const claude = readJson(join(pluginRoot, ".mcp.json"));

  assert.deepEqual(Object.keys(portable).sort(), ["$schema", "mcpServers"]);
  assert.equal(
    portable.$schema,
    "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json",
  );
  assert.deepEqual(Object.keys(portable.mcpServers), ["volato"]);
  assert.deepEqual(portable.mcpServers.volato, {
    type: "streamable-http",
    url: "https://mcp.volato.dev/mcp",
  });
  assert.equal(
    claude.mcpServers.volato.url,
    portable.mcpServers.volato.url,
  );
});
