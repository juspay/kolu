---
name: state
description: >-
  Persistent state schema migration requirements — the one schema, one migration ladder, and the fail-fast host-map membership rule. Use when changing anything that is persisted.
---

## Persistent State (conf)

State is stored via `conf` in `packages/server/src/state.ts`, which owns the on-disk shape (`PersistedStateSchema`, internal to that file) and the migration ladder. Domain modules (`preferences.ts`, `hostPersistence.ts`) read and write their own keys against the shared `store`.

When changing what is persisted (any of the per-domain schemas — `PreferencesSchema` in `packages/common/src/surface.ts`, `PersistedHostsSchema` in `packages/common/src/hostKey.ts`), **you must add a migration** in `state.ts`'s `migrations` object and bump `SCHEMA_VERSION`. Without a migration, existing users' state files silently lose or misinterpret data on schema changes.

The disk shape is one schema, one migration ladder, one source of truth. `PersistedStateSchema` is intentionally not exported; consumers go through the domain accessors (`getPreferences()`, `getPersistedHosts()`).

**The works ride it too.** `works` is the `PersistedStateSchema` key holding every piece of work kolu stores (`kolu-work`'s `Work` plus each member's per-terminal wake bookkeeping — `kolu-conductor`'s `PersistedWorksSchema`). It is real user data: a work carries the human's decisions, its timeline and the files kolu kept when it ended, and it outlives the conversation that opened it. Same schema, same ladder, same fail-fast as `hosts`. Changing its shape takes a rung and a `SCHEMA_VERSION` bump like anything else.

**One file this store does not own — and it still rides this ladder.** The conductor's transcript rows live in `<KOLU_STATE_DIR>/conductor/transcript.json`, not in `config.json`: they were ~90% of that file's bytes and `conf` rewrites the whole file on every `set`, so a keystroke re-serialized the fleet and the host map with it. The file is `{"version": "<ladder version>", "rows": [...]}`, written atomically at mode 0600 by `packages/server/src/conductor/transcriptFile.ts`.

It gets NO ladder of its own. The rule, in one sentence: **a change to the row shape is a rung in `state.ts` that rewrites that file, and `TRANSCRIPT_FILE_VERSION` (exported from `state.ts`) moves to that rung's number.** A file stamped with anything else is refused BY NAME on read — never re-shaped on the fly, never read as a guess. The 1.50.0 rung is the worked example: it moved `conductor.rows` out of the store into the file and deleted the key. Note the state-backup ring (`stateBackups.ts`) snapshots `config.json` ALONE, so the transcript is not in backups — it is the one piece of this state root worth nothing to a restore.

**Host-map membership rides this store too — it is not a special case.** The fleet you add via the selector strip persists as the `hosts` field of `PersistedStateSchema`, owned by `hostPersistence.ts` (its `getPersistedHosts()` reader + `savePoolMembership()` persist-hook shaper) and carried by the SAME schema + migration ladder as every other domain. It IS real user data (unlike `preferences`, a silent reset would eat the fleet), so it must never be silently emptied — and `conf` already guarantees that: a corrupt/unparseable store **THROWS on read** (`clearInvalidConfig` is false, conf 15's default), it does NOT reset to defaults. That fail-fast is exactly why `hosts` belongs in this store rather than a hand-rolled file. An invalid-but-parseable value (a hand-edited `local`, a duplicate) additionally fails loud where it's read — `getPersistedHosts` re-validates through `PersistedHostsSchema` (in `kolu-common/hostKey`) and throws, never silently normalizing. Changing the `hosts` shape takes a migration + `SCHEMA_VERSION` bump like any other domain.
