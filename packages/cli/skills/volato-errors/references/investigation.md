# Investigation paths

Use these CLI calls as bounded primitives. They print agent-ready Markdown by
default and stable structured data with `--json`.

## One group or the latest production error

1. Run `volato errors show --json` for the most recent unresolved production
   group, or `volato errors show <group-id> --json` for an explicit group.
2. If the response has no group, stop with the bounded “nothing to fix” result.
3. Keep only the fields needed to test the cause: group metadata, representative
   events, resolved frame, resolution state, commit transition, affected-user
   summary, resolution history, and similar resolved groups.
4. Inspect the referenced local code and Git transition before proposing a
   change.

Omitting the id is intentional. Do not list every group first when the user
asked for the latest error.

## Broad problem or post-deploy regression

Start with the narrowest current read surface:

```text
volato errors list --status unresolved --environment production --json
volato errors list --release <release> --status unresolved --environment production --json
volato errors list --query <text> --status all --environment production --json
```

Use `--project-id` in a multi-project workspace. Bound the result with
`--limit`. Compose JSON through ephemeral `jq`, JavaScript, or TypeScript when
ranking or comparing results would otherwise flood model context. Such code is
investigation-local: do not register a persistent tool or send arbitrary code
to Volato.

For each plausible group, call `volato errors show <group-id> --json` only
until one cause is sufficiently supported. Rank evidence by new appearance,
impact, frequency, and fit with the requested route or release. If the current
CLI cannot establish a release comparison or growth claim, say so; do not
simulate unsupported server evidence from local Git history.

## Exit behavior

- `0`: consume the bounded result.
- `3`: authentication or inactive subscription; ask for the minimum human
  authorization needed, then resume.
- `4`: inaccessible or missing resource; verify workspace/project scope.
- `5`: rate limited; honor the retry window.
- `1`: local, usage, or transport failure; diagnose it before continuing.

Do not parse human prose for branching when structured output is available.
