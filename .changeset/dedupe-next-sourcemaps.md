---
"@volatodev/cli": patch
---

Deduplicate source-map uploads shared by Next.js webpack compilers so a production build sends each map once and stays within the protected ingest budget.
