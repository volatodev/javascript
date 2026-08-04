# Changesets

This directory contains pending changesets for the Volato JavaScript monorepo. Changesets describe the version bump and release notes for upcoming releases.

To create a new changeset, run:

```bash
pnpm changeset
```

See the [changesets documentation](https://github.com/changesets/changesets) for more information.

The repository stays in the `beta` prerelease channel until the first stable
release. CI validates commits and release candidates, but it never versions or
publishes a package. Versioning and publishing are explicit local operations by
the maintainer.

From a clean `main` synchronized with `origin/main`:

```bash
pnpm run version
git diff
git add .
git commit -m "chore: version packages"
git push origin main
```

After CI passes, publish from the same clean commit with an npm account that
can publish `@volatodev/cli`:

```bash
npm whoami
pnpm release:beta
```

`release:beta` reruns the complete local gate, publishes the immutable version
under `beta`, installs and exercises that exact registry artifact, then moves
`latest`. If publication succeeds but the registry smoke is interrupted, rerun
only the safe promotion half:

```bash
pnpm release:promote
```

Until the first stable release, `beta` and `latest` both point to the current
alpha so the documented unqualified install command cannot resolve to an older
prerelease.
