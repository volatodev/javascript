import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const skill = (name: string): string =>
  readFileSync(
    new URL(`../../skills/${name}/SKILL.md`, import.meta.url),
    "utf8",
  );

const setup = skill("volato-setup");
const cliReadme = readFileSync(
  new URL("../commands/readme.ts", import.meta.url),
  "utf8",
);

describe("framework integration skill contracts", () => {
  it.each([
    ["volato-vite-vue", "Vite + Vue 3"],
    ["volato-vite-svelte", "Vite + Svelte 5"],
    ["volato-fastify", "Fastify 5"],
    ["volato-nestjs", "NestJS 11/12 HTTP"],
    ["volato-angular", "Angular 20/21/22"],
  ])("ships %s as a discoverable bounded skill", (name, scope) => {
    const source = skill(name);
    const metadata = source.slice(0, source.indexOf("---", 4));
    const openai = readFileSync(
      new URL(`../../skills/${name}/agents/openai.yaml`, import.meta.url),
      "utf8",
    );

    expect(metadata).toContain(`name: ${name}`);
    expect(source).toContain(scope);
    expect(source).toContain("volato errors init");
    expect(source).toMatch(/production(?: Nest CLI)? build/i);
    expect(source).toMatch(/exact (?:repository )?source/i);
    expect(openai).toContain("default_prompt:");
  });

  it("routes every supported renderer and HTTP owner independently", () => {
    for (const name of [
      "volato-nextjs",
      "volato-vite-react",
      "volato-vite-vue",
      "volato-vite-svelte",
      "volato-node",
      "volato-fastify",
      "volato-nestjs",
    ]) {
      expect(setup).toContain(`\`${name}\``);
      expect(cliReadme).toContain("\\`" + name + "\\`");
    }
    expect(setup).toMatch(/NestJS owns\s+HTTP capture/i);
    expect(setup).toMatch(/frontend and backend independently/i);
  });

  it("keeps target-specific privacy and refusal boundaries explicit", () => {
    const vue = skill("volato-vite-vue");
    const svelte = skill("volato-vite-svelte");
    const fastify = skill("volato-fastify");
    const nest = skill("volato-nestjs");
    const angular = skill("volato-angular");

    expect(vue).toMatch(/component instance/i);
    expect(vue).toMatch(/Vue 2|Nuxt/);
    expect(svelte).toMatch(/event-handler.*browser-global/is);
    expect(svelte).toMatch(/SvelteKit|hydration/);
    expect(fastify).toMatch(/body.*cookies.*query/is);
    expect(fastify).toMatch(/preserve.*error handler/is);
    expect(nest).toMatch(/BaseExceptionFilter/);
    expect(nest).toMatch(/do not install.*Fastify.*Express/is);
    expect(nest).toMatch(/GraphQL|WebSockets|microservices/);
    expect(angular).toMatch(/private Angular candidate/i);
    expect(angular).toMatch(/SSR.*hydration.*NgModule/is);
    expect(angular).toMatch(/custom root `ErrorHandler`/i);
    expect(setup).toContain("`volato-angular`");
    expect(cliReadme).not.toContain("`volato-angular`");
  });
});
