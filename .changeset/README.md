# Changesets

This directory contains pending changesets for the Volato JavaScript monorepo. Changesets describe the version bump and release notes for upcoming releases.

To create a new changeset, run:

```bash
pnpm changeset
```

See the [changesets documentation](https://github.com/changesets/changesets) for more information.

The repository stays in the `beta` prerelease channel until the first stable
release. Versioning remains an explicit maintainer operation. Publishing is
automatic and tokenless: a change to `packages/cli/package.json` on `main`
starts `.github/workflows/publish-beta.yml`, which gates the candidate, publishes
it through npm trusted publishing, downloads the immutable registry artifact
and runs the standard public canaries.

From a clean `main` synchronized with `origin/main`:

```bash
pnpm run version
git diff
git add .
git commit -m "chore: version packages"
git push origin main
```

The npm package must trust this exact GitHub Actions identity:

- owner: `volatodev`;
- repository: `javascript`;
- workflow filename: `publish-beta.yml`;
- environment: `npm-beta`;
- allowed action: `npm publish`.

The workflow publishes the prerelease directly under `latest`, which is the tag
used by the public unqualified install command. npm OIDC authorizes the publish
operation itself, not later dist-tag mutations, so `beta` is not a release
authority. The immutable version and `latest` must agree before the canaries
run.

`workflow_dispatch` safely rechecks the version currently present in
`package.json`. If it is already published, the mutation is skipped and the
public canaries are replayed.

For emergency local recovery only, the authenticated maintainer path remains:

```bash
npm whoami
pnpm release:beta
```

It requires npm's interactive write authentication and is not the normal
release path.
