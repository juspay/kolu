---
paths:
  - "packages/server/src/state.ts"
---

## Persistent State (conf)

State is stored via `conf` in `packages/server/src/state.ts`. When modifying `PersistedState` (defined in `packages/common/src/index.ts`), classify the field first — the rule is different for recoverable UI state vs. accumulated user data.

- **Preferences (recoverable):** no migration. `getServerState` runs `PreferencesSchema.safeParse` on the persisted blob and falls back to `DEFAULT_PREFERENCES` on any mismatch. Adding, removing, renaming, or tightening a preference field requires zero changes to the `migrations` object — old persisted shapes that no longer validate are reset on next read. Do **not** bump `SCHEMA_VERSION` for preference-only changes.
- **User data (`recentRepos`, `recentAgents`, `session`):** add a migration in the `migrations` object **and** bump `SCHEMA_VERSION`. These fields can't be reconstructed by the user — they must be carried forward across schema changes. Without a migration, existing users silently lose recent-repos history, agent MRU, or saved terminal layouts.

Rule of thumb: if losing the field's content is recoverable by toggling a setting, it's preferences — let `safeParse` handle it. If it represents activity the user accumulated over time, write a migration.

Note: `ServerState` extends `PersistedState` with runtime fields — only `PersistedState` is written to disk.
