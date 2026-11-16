/**
 * THE PERSISTED SHAPE of kolu-server's state root — what `config.json` holds,
 * at which version, and what a fresh install starts from. No store is opened
 * here and no file is read: this module is pure, so both the live root
 * (`state.ts`) and the frozen migration ladder (`stateLadder.ts`) can import
 * it without either dragging the other in.
 *
 * Stores recoverable state at ~/.config/kolu/state.json (or wherever
 * KOLU_STATE_DIR points — `state.ts` decides). The on-disk shape
 * (`PersistedStateSchema`) is an implementation detail; `preferences.ts`
 * reads/writes its key against the shared `store` rather than reaching for it
 * directly, and the schema itself is exported only to this module's two
 * siblings (`dev/skills/state/SKILL.md`).
 *
 * `session` and `activityFeed` USED to live here too; W2.2 moved them onto the
 * padi PROCESS's own state-root store (`@kolu/padi`'s `stateStore.ts`), so this
 * store holds `preferences` and — since W10 — `hosts`. The 1.31.0 migration in
 * `stateLadder.ts` strips the legacy `session` / `activityFeed` residue (and
 * the older orphan `sleepingTerminals` / `lastPairedDaemon` keys) off any
 * pre-W2.2 file — backing it up first so a fresh padi's one-shot legacy import
 * stays recoverable.
 *
 * `hosts` (W10 — the fleet you add through the selector strip) also lives here,
 * as a field on `PersistedStateSchema`. That is deliberate: `conf` is FAIL-FAST — a
 * corrupt/unparseable store THROWS on read (`clearInvalidConfig` is false; conf 15's
 * default), it does NOT silently reset to defaults. So `hosts` (unlike `preferences`,
 * it is real user data a silent reset would eat) rides the same store, schema, and
 * migration ladder as everything else, and a corrupt store fails loud rather than
 * emptying the fleet. A MISSING file is a fresh install (empty → defaults merge in);
 * a PRESENT-but-corrupt one crashes the boot.
 */

import type Conf from "conf";
import { Schema } from "effect";
import { PersistedHostsSchema } from "kolu-common/hostKey";
import {
  DEFAULT_PREFERENCES,
  PreferencesSchema,
  ViewerModeSchema,
} from "kolu-common/surface";
import {
  EMPTY_PERSISTED_CONDUCTOR,
  EMPTY_PERSISTED_MEMBERS,
  PersistedConductorSchema,
  PersistedMembersSchema,
  PersistedWorksSchema,
} from "kolu-conductor";

/** What conf stores to disk — survives server restart. Internal: each domain module
 *  (`preferences.ts`, `hostPersistence.ts`) reads its own per-domain shape, not this
 *  aggregate. `session` / `activityFeed` left this store at W2.2 (they are padi's now);
 *  the 1.31.0 migration strips their legacy residue. `hosts` (W10) is the strip-added
 *  fleet, validated by `PersistedHostsSchema` (rejects `local` + duplicates) so a
 *  hand-corrupted list fails loud, never silently normalized. `viewerMode` is the LAST
 *  reading a browser reported of its OS light/dark leaning — remembered so a headless
 *  face (MCP, CLI) creating a terminal on a server no browser has dialled yet still
 *  resolves an "auto" shuffle against a real answer. `conductor` is the ONE
 *  conversation's resumable half — the session id, the directory it was opened
 *  in, the model a person chose and the fleet it touched (its transcript rows
 *  live in their own file since 1.50.0 — see that rung). `works` is the pieces
 *  of work kolu has stored: what the Conductor stated, what the human decided
 *  and what kolu observed. `members` is what the WATCH knows about each member
 *  terminal, keyed by fleet ref — what it was last called, the agent seen in
 *  it, the level the conversation was already told about — kept beside the
 *  works rather than inside them because it is a fact about a terminal rather
 *  than part of what a work is, and it moves every time a host is read. None
 *  of the three is a served cell (all are assembled from the LIVE record);
 *  this is only what a restart has to start from, and it lives here because
 *  kolu-server HOSTS the conversation. Adding a new domain key requires a
 *  migration entry in `stateLadder.ts`.
 *
 *  Exported to THIS MODULE'S TWO SIBLINGS ONLY — `state.ts` (the boot decode
 *  and the restore path's `DecodedStateBackup`) and the ladder's rungs.
 *  Consumers outside go through the domain accessors
 *  (`dev/skills/state/SKILL.md`). */
export const PersistedStateSchema = Schema.Struct({
  preferences: PreferencesSchema,
  hosts: PersistedHostsSchema,
  viewerMode: ViewerModeSchema,
  conductor: PersistedConductorSchema,
  works: PersistedWorksSchema,
  members: PersistedMembersSchema,
});

/** The DECODED disk shape. Effect's `Struct.Type` is deep-`readonly`; `Conf` is
 *  typed against a MUTABLE record (its `set`/`get` signatures index it), and the
 *  migration ladder below writes whole domain values back through `store.set`.
 *  So the store's type parameter is the mutable projection of the decoded shape —
 *  the SAME fields, the same bytes, just without the `readonly` markers that would
 *  make every `store.set("preferences", …)` a compile error. Nothing outside this
 *  module and its two siblings sees it — `dev/skills/state/SKILL.md`. */
export type PersistedState = {
  -readonly [K in keyof typeof PersistedStateSchema.Type]: (typeof PersistedStateSchema.Type)[K];
};

/** Decode a value against {@link PersistedStateSchema}, as a `Result` — the
 *  Effect Schema successor of zod's `.safeParse`. Compiled once at module scope:
 *  `decodeUnknownResult` re-derives the parser per application otherwise, and the
 *  boot check in `state.ts` runs on every process start.
 *
 *  There is NO explicit-`undefined` strip in front of it (PLAN #17's obligation for
 *  in-process `.parse` callers), and that is a fact about this schema rather than an
 *  omission: every field of the disk shape — the three top-level keys, all eleven
 *  `Preferences` fields, both `rightPanel` fields — is REQUIRED. No `optionalKey`
 *  appears anywhere in it, so there is no key an explicit `undefined` could ride in
 *  on, and `Schema.optionalKey`'s stricter-than-zod rejection has nothing to bite.
 *  The one place the repo's optional keys live (`PreferencesPatchSchema`) is a WIRE
 *  patch, never persisted. */
export const decodePersistedState =
  Schema.decodeUnknownResult(PersistedStateSchema);

/** Read EVERY persisted key off a store, keyed off the SCHEMA's own field list
 *  (`Schema.Struct` exposes it as `.fields`, zod's `.shape`) rather than a
 *  hand-written key list. "Which keys this store persists" is the most volatile
 *  fact in this file — the ladder has 36 rungs and three of them move the
 *  key set — so both decode sites (the boot check and the backup restore) read
 *  the schema instead of re-listing it: a new key joins them with no edit, and
 *  cannot silently decode as three-of-four. */
export function readPersistedRecord(
  from: Conf<PersistedState>,
): Record<string, unknown> {
  return Object.fromEntries(
    (Object.keys(PersistedStateSchema.fields) as (keyof PersistedState)[]).map(
      (key) => [key, from.get(key)],
    ),
  );
}

/**
 * Schema version — bump this when adding migrations.
 * Must be valid semver. `conf` runs all migration handlers
 * whose keys are > the last-seen version and ≤ this value.
 */
export const SCHEMA_VERSION = "1.56.0";

/** THE VERSION STAMPED INTO THE TRANSCRIPT FILE
 *  (`<stateDir>/conductor/transcript.json`), and the one a reader accepts.
 *
 *  The transcript file is part of the state root's ONE ladder
 *  (`stateLadder.ts`) — it does not get one of its own. The rows moved out of
 *  `config.json` at 1.50.0 because they are 90% of a file rewritten on every
 *  keystroke, not because they became a separate piece of state: they are
 *  still the one conversation's, still written by this process, still bounded
 *  by `ROW_CAP`. So the rule is one sentence: a future change to the row
 *  shape is a RUNG THERE that rewrites the file, and this constant moves to
 *  that rung's number. A file stamped with anything else is refused by name
 *  ({@link transcriptFileStore}) — never read as a guess, never silently
 *  re-shaped.
 *
 *  Lives beside `SCHEMA_VERSION` rather than beside the store that reads it,
 *  and for the same reason: these two constants are what version the state
 *  root is at, and the ladder is written against them. A rung that stamped a
 *  file keeps its OWN frozen copy of the number it stamped
 *  (`TRANSCRIPT_VERSION_1_53_0`, `TRANSCRIPT_VERSION_1_55_0`) — this one is
 *  the live head. It reads 1.55.0 because that rung rewrote every `work-ask`
 *  row's ask: an outcome that could say "answered" with nothing in it became
 *  a standing that cannot. */
export const TRANSCRIPT_FILE_VERSION = "1.55.0";

/** The store's `defaults` — hoisted so {@link decodeStateBackup}'s scratch
 *  store merges the same seed the live store does. */
export const CONF_DEFAULTS: PersistedState = {
  preferences: DEFAULT_PREFERENCES,
  // W10 — the strip-added fleet. Fresh install: no `hosts` key yet, so conf merges this
  // empty default (a one-member local-only pool); a genuine fleet is written by the
  // pool's `persist` hook on the first strip add. The 1.33.0 migration seeds it onto an
  // existing pre-W10 file so the on-disk shape matches the schema exactly.
  hosts: [],
  // The last OS light/dark reading a browser published. `"dark"` matches
  // `DEFAULT_PREFERENCES.colorScheme`, so a server no browser has ever dialled
  // resolves an "auto" shuffle exactly as a default install does. The 1.36.0
  // migration seeds it onto an existing file for the same on-disk-shape reason.
  viewerMode: "dark",
  // The ONE conversation, empty. A fresh install has nothing to resume; the
  // 1.44.0 migration seeds this onto an existing file for the same
  // on-disk-shape reason the two keys above give, and 1.45.0 carries a record
  // already written under the conversation's old name across to this key.
  conductor: EMPTY_PERSISTED_CONDUCTOR,
  // NO PIECES OF WORK YET. A fresh install has stored none; the 1.50.0
  // migration seeds this onto an existing file (from the watch list that
  // preceded it) for the same on-disk-shape reason the keys above give.
  works: {},
  // ... and nothing known about any member terminal, for the same reason and
  // out of the same rung: `members` is the watch's own memory, keyed by fleet
  // ref, and a fresh install has read no host yet.
  members: EMPTY_PERSISTED_MEMBERS,
};
