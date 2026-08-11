---
"@volatodev/cli": patch
---

Keep a dirty local verification build from replacing sourcemaps for the last
deployed Git release. Explicit release identities remain available for CI, and
Vite and Node maps are privacy-cleaned even when their upload is skipped.
