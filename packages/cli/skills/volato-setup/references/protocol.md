# Volato generated-integration contract

Generated source sends error events to the origin encoded in the project DSN:

```text
POST <dsn-origin>/api/ingest
Content-Type: application/json
X-Volato-DSN: <dsn>
```

The DSN is browser-safe and grants event submission only. Never place
`VOLATO_INGEST_TOKEN` in application code or a browser-visible variable; it
grants sourcemap write and deletion.

Every event must include:

```json
{
  "v": 1,
  "type": "TypeError",
  "message": "Example",
  "runtime": "client",
  "timestamp": 1700000000000
}
```

Preserve the privacy contract:

- never capture request bodies;
- scrub sensitive query-string values;
- remove `sourcesContent` from sourcemaps before upload;
- warn visibly after exhausted transport retries;
- keep the ingest token in the build environment only.
