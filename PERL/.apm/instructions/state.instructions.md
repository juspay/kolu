---
description: Persistent state schema migration requirements
applyTo: "server/src/state.ts"
---

## Persistent State (conf)

- State is stored via `conf` in `server/src/state.ts`. When modifying `StateSchema`, **you must add a migration** in the `migrations` object and bump `SCHEMA_VERSION`. Without a migration, existing users' state files silently lose or misinterpret data on schema changes.
