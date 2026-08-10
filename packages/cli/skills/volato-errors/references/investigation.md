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

Identify the captured release boundary before ranking groups:

```text
volato releases list --project-id <project-id> --environment production --json
volato releases compare [<head-release>] --project-id <project-id> --json
volato errors list --release <head-release> --sort growth --status all --project-id <project-id> --json
```

`releases compare` defaults to the latest and immediately previous captured
releases. Its `new` and `aggravated` classifications prioritize candidates;
counts are raw per-release observations, not traffic- or duration-normalized.
Use an explicit `--base` when deploy overlap or separate release histories make
the captured predecessor inappropriate. Never invent a common release for
separately deployed browser and Node applications.

Narrow with the stable filters before enriching a group:

```text
volato errors list --runtime node --route /api/checkout --min-events 3 --min-users 2 --sort users --json
volato errors list --query <text> --fingerprint <substring> --status all --json
volato errors samples <group-id> --strategy all --limit 5 --json
```

The list surface also accepts first/last-seen ISO boundaries. Event samples are
bounded, deduplicated roles (`recent`, `representative`, `variation`) and omit
bodies, cookies, headers, query values, arbitrary tags, and user identity.

Use `--project-id` in a multi-project workspace and always bound results with
`--limit`. Compose JSON through ephemeral local `jq`, JavaScript, or TypeScript
when comparison would otherwise flood model context. For example:

```sh
volato releases compare --project-id "$PROJECT_ID" --json \
  | jq '[.changes[] | select(.classification == "new" or .classification == "aggravated") | {id, message, classification, delta, runtimes, routes}]'
```

Such code is investigation-local: do not register a persistent tool, modify
Volato state, or send arbitrary code to Volato.

For each plausible group, sample only when group aggregation is insufficient,
then call `volato errors show <group-id> --json` only until one cause is
sufficiently supported. Rank evidence by new appearance, impact, frequency,
and fit with the requested route or release. Treat comparison as candidate
selection, not proof that the latest commit caused the error.

## Exit behavior

- `0`: consume the bounded result.
- `3`: authentication or inactive subscription; ask for the minimum human
  authorization needed, then resume.
- `4`: inaccessible or missing resource; verify workspace/project scope.
- `5`: rate limited; honor the retry window.
- `1`: local, usage, or transport failure; diagnose it before continuing.

Do not parse human prose for branching when structured output is available.
