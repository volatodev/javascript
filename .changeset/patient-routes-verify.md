---
"@volatodev/cli": patch
---

Give cold Next.js verification routes enough time to compile before retrying,
preventing an accepted first capture from being mistaken for a deduplicated
ingest rejection on Next.js 15.
