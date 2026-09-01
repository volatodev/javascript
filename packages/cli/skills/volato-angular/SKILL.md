---
name: volato-angular
description: Generate, compose, and verify dependency-free Volato Errors browser capture for the supported Angular 20/21/22 integration. Use only when volato-setup detects one client-rendered standalone TypeScript Angular CLI application using @angular/build:application. Refuse SSR, hydration, NgModule or dynamic bootstrap, multiple projects, alternate builders, custom output paths, and unsupported change-detection shapes.
---

# Set up Volato for Angular

Use the CLI recipe as the only source of generated code and keep the public
support boundary exact.

## Workflow

1. Confirm one root Angular CLI application, Angular 20, 21 or 22, one static
   `bootstrapApplication` using an imported `ApplicationConfig`, TypeScript,
   `@angular/build:application`, its default output path and `ng build` script.
2. Accept Angular 20 with its fresh Zone.js default or explicit
   `provideZonelessChangeDetection`. Accept Angular 21/22 only in their fresh
   zoneless mode. Refuse every other lifecycle before mutation.
3. Run `volato init --project <id>` when the repository is not linked, then run
   `volato errors init`.
4. Inspect `src/volato/`, the first application provider, `angular.json`, the
   package build script, protected local environment file and the
   `errors-browser-angular` manifest entry. Confirm no Volato runtime dependency
   was added.
5. If the application provides a custom root `ErrorHandler`, verify Volato
   invokes that exact handler synchronously with the original error and receiver
   after scheduling capture. Never replace its application behaviour.
6. Run the real production build. Require one Git release, a server-only token,
   successful upload of hidden maps without `sourcesContent`, and removal of
   every public `.js.map` artifact.
7. In a real browser, exercise manual capture, one window error, one unhandled
   rejection and one Angular component/lifecycle failure. Each original error
   emits once; the framework event reports `runtime=browser` and
   `capturedVia=angular_error_handler`.
8. Resolve a production chunk frame to the exact repository TypeScript source
   and line. Retrieve it with the Volato Errors CLI or MCP, patch and test the
   local cause, and leave production recovery unresolved.

## Boundaries

- Never serialize component instances, dependency-injection state, props,
  application state, arbitrary objects, cookies, query values or source text.
- Never put `VOLATO_INGEST_TOKEN` into Angular application code or the injected
  browser configuration.
- Preserve provider order after the inserted Volato provider, the resolved root
  `ErrorHandler`, bootstrap behaviour and the repository's pre/postbuild hooks.
- Refuse SSR, prerendering, hydration, NgModule bootstrap, multiple projects,
  custom builders or output paths, custom build commands and edited generated
  files before mutation.
- Do not infer or instrument an API merely because the Angular builder runs on
  Node.js.

## Completion

The supported Angular integration is ready only after setup converges, the
application's frozen cell builds and captures, privacy and exact source
resolution pass, and the production recovery remains unresolved until the
fix is deployed and verified.
