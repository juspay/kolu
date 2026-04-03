---
paths:
  - "server/src/state.ts"
---

## Persistent State (conf)

- State is stored via `conf` in `server/src/state.ts`. When modifying `PersistedState` (defined in `common/src/index.ts`), **you must add a migration** in the `migrations` object and bump `SCHEMA_VERSION`. Without a migration, existing users' state files silently lose or misinterpret data on schema changes. Note: `ServerState` extends `PersistedState` with runtime fields — only `PersistedState` is written to disk.
