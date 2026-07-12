---
paths:
  - "packages/server/src/{state,preferences,activity,session,hostPersistence}.ts"
---

## Persistent State (conf)

State is stored via `conf` in `packages/server/src/state.ts`, which owns the on-disk shape (`PersistedStateSchema`, internal to that file) and the migration ladder. Domain modules (`preferences.ts`, `activity.ts`, `session.ts`) read and write their own keys against the shared `store`.

When changing what is persisted (any of the per-domain schemas in `packages/common/src/index.ts` — `PreferencesSchema`, `ActivityFeedSchema` field types, `SavedSessionSchema`), **you must add a migration** in `state.ts`'s `migrations` object and bump `SCHEMA_VERSION`. Without a migration, existing users' state files silently lose or misinterpret data on schema changes.

The disk shape is one schema, one migration ladder, one source of truth — even though three domain modules read from it. `PersistedStateSchema` is intentionally not exported; consumers go through the domain accessors (`getPreferences()`, `getActivityFeed()`, `getSavedSession()`).

**Not everything server-side lives in this `conf` store.** Host-map membership (the fleet you add via the selector strip) persists through a **separate** atomic-JSON file — `hosts.json` beside `config.json`, owned by `hostPersistence.ts` and wired into the pool's `persist` hook — **not** this store, and deliberately: `conf` data is reconstructible so a corrupt file safely resets to defaults, but a silently-emptied fleet is data loss, so `hosts.json` **fail-fast crashes** the boot (naming the path) instead. It has its own tiny `{ version, hosts }` schema; it is not part of `PersistedStateSchema` or its ladder. Don't fold it back into `conf`.
