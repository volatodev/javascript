# Changesets

This directory contains pending changesets for the Volato JavaScript monorepo. Changesets describe the version bump and release notes for upcoming releases.

To create a new changeset, run:

```bash
pnpm changeset
```

See the [changesets documentation](https://github.com/changesets/changesets) for more information.

The repository stays in the `beta` prerelease channel until the first stable
release. CI may prepare version changes, but it never publishes a package.
Publishing is an explicit action through the `Publish beta CLI` workflow and
requires the exact version from `packages/cli/package.json`.
