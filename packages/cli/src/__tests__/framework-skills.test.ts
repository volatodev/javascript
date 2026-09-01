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
    ["volato-fastapi", "FastAPI 0.141"],
    ["volato-sveltekit", "SvelteKit 2.70.3"],
    ["volato-astro", "Astro 7.2.9"],
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
      "volato-angular",
      "volato-fastapi",
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
    const fastapi = skill("volato-fastapi");
    const sveltekit = skill("volato-sveltekit");
    const astro = skill("volato-astro");

    expect(vue).toMatch(/component instance/i);
    expect(vue).toMatch(/Vue 2|Nuxt/);
    expect(svelte).toMatch(/event-handler.*browser-global/is);
    expect(svelte).toMatch(/SvelteKit|hydration/);
    expect(fastify).toMatch(/body.*cookies.*query/is);
    expect(fastify).toMatch(/preserve.*error handler/is);
    expect(nest).toMatch(/BaseExceptionFilter/);
    expect(nest).toMatch(/do not install.*Fastify.*Express/is);
    expect(nest).toMatch(/GraphQL|WebSockets|microservices/);
    expect(angular).toMatch(/supported Angular integration/i);
    expect(angular).toMatch(/SSR.*hydration.*NgModule/is);
    expect(angular).toMatch(/custom root `ErrorHandler`/i);
    expect(setup).toContain("`volato-angular`");
    expect(cliReadme).toContain("\\`volato-angular\\`");
    expect(fastapi).toMatch(/supported FastAPI integration/i);
    expect(fastapi).toMatch(/HTTPException.*validation/is);
    expect(fastapi).toMatch(/WebSocket.*streaming.*lifespan.*background/is);
    expect(fastapi).toMatch(/body.*cookies.*authorization.*query/is);
    expect(setup).toContain("`volato-fastapi`");
    expect(cliReadme).toContain("\\`volato-fastapi\\`");
    expect(sveltekit).toMatch(/private SvelteKit candidate/i);
    expect(sveltekit).toMatch(/handleError.*return value/is);
    expect(sveltekit).toMatch(/expected.*error.*emit nothing/is);
    expect(sveltekit).toMatch(/service workers.*remote functions.*prerender/is);
    expect(setup).toContain("`volato-sveltekit`");
    expect(cliReadme).not.toContain("`volato-sveltekit`");
    expect(astro).toMatch(/private Astro candidate/i);
    expect(astro).toMatch(/static.*Actions.*alternate adapters.*mixed renderers/is);
    expect(astro).toMatch(/URL.*params.*query.*body.*cookies.*sessions/is);
    expect(setup).toContain("`volato-astro`");
    expect(cliReadme).not.toContain("`volato-astro`");
  });
});
