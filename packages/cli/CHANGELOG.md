# @volatodev/cli

## 0.1.0-beta.3

### Minor Changes

- Add an authenticated project command that lets coding agents replace or clear
  the browser-origin allowlist during setup.

### Patch Changes

- bd90b75: Use one automatically detected Git commit for runtime events and sourcemap
  uploads, removing the need for users to configure or publish a Volato release.

## 0.1.0-beta.2

### Minor Changes

- ec0ff56: Add authenticated `volato init --project`, automatic skill installation,
  protected local credential setup, and production-build conformance for
  Next.js 15 and 16.

## 0.1.0-beta.1

### Minor Changes

- feac841: Replace SDK-oriented setup with portable agent skills and deterministic
  framework recipes, including bounded direct event delivery, safe payload
  serialization, and fresh-project artifact conformance.
