/**
 * THE MIGRATION LADDER — every shape this store has ever had, and the rung
 * that walked it to the next one.
 *
 * Frozen history, and nothing else. A rung that has already run on somebody's
 * store is never edited, never renumbered and never squashed
 * (`dev/skills/state/SKILL.md`), so this module is pure and has NO
 * module-level effects: it opens no store, reads no environment, touches no
 * file at import. Every rung takes the `Conf` it works on as a PARAMETER —
 * which is what makes a rung this size runnable from a test without a live
 * state root, and what lets `state.ts` import the ladder rather than the other
 * way round.
 *
 * It holds the ten `migratePreferences_*` converters, the frozen-history types
 * and helpers each rung reads its own era's records through
 * (`WatchedEntry_1_49_0`, `Work_1_52_0`, `CHECK_KINDS_1_51_0`, the 1.53.0
 * work-key encodings …), the legacy-key utilities, and `CONF_MIGRATIONS` —
 * the append-only table `state.ts` hands to `Conf`. The shape those rungs
 * migrate TOWARDS lives in `stateShape.ts`; the live store that walks them
 * lives in `state.ts`.
 *
 * Frozen history reads as little live as it can. A rung's inputs and the
 * encodings it WRITES are copied here under the rung's own number rather than
 * imported from the model packages — `kolu-work` is free to move, and a rung
 * must keep producing the bytes it was proven against (the 1.51.0 rung learned
 * that when check events grew a typed head; 1.53.0 carries its own work-key
 * encodings and its own transcript stamp for the same reason).
 */

import { randomUUID } from "node:crypto";
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
} from "node:fs";
import { dirname, join } from "node:path";
import type Conf from "conf";
import type { ConductorRow } from "kolu-common/conductor";
import { DEFAULT_PREFERENCES, type Preferences } from "kolu-common/surface";
import {
  EMPTY_PERSISTED_CONDUCTOR,
  repointConductorAttachments,
} from "kolu-conductor";
import {
  transcriptFilePath,
  writeTranscriptFile,
} from "./conductor/transcriptFile.ts";
import { log } from "./log.ts";
import { type PersistedState, TRANSCRIPT_FILE_VERSION } from "./stateShape.ts";

/** Convert a pre-1.30 `preferences` record — where the on/off `shuffleTheme`
 *  boolean chose whether new terminals auto-picked a distinct theme — to the
 *  two fields that replaced it: `newTerminalTheme` (`inherit` | `shuffle`, the
 *  creation strategy) and `shuffleBehavior` (the pool a shuffle draws from).
 *  `true` → `{ shuffle, auto }` (keep auto-picking a distinct tint, now
 *  mode-matched — the old behaviour, minus the jarring cross-mode picks);
 *  `false` → `{ inherit, auto }` (don't auto-shuffle — new terminals inherit
 *  the active one, seeded from the server default, exactly as `false` behaved
 *  until the user themes a tile). The legacy field is dropped.
 *
 *  Keyed off the PRESENCE of `shuffleTheme` and always wins over the values the
 *  1.10.0 step spreads in (it spreads the current `DEFAULT_PREFERENCES`, which
 *  now carries both new fields), so a very old record arriving with all three
 *  still takes its real intent from `shuffleTheme`. A record with no
 *  `shuffleTheme` (a fresh ≥1.30 install) is returned untouched.
 *
 *  Exported so `state.test.ts` can exercise the conversion directly without
 *  spinning up a `Conf` store under `KOLU_STATE_DIR`. */
export function migratePreferences_1_30_0(
  current: Record<string, unknown>,
): Record<string, unknown> {
  if (!("shuffleTheme" in current)) return current;
  const { shuffleTheme, ...rest } = current as { shuffleTheme?: unknown };
  const newTerminalTheme = shuffleTheme === false ? "inherit" : "shuffle";
  return {
    ...rest,
    newTerminalTheme,
    shuffleBehavior: DEFAULT_PREFERENCES.shuffleBehavior,
  };
}

/** 1.37.0 — the Agents setting joined preferences. Seeds what 1.37 shipped as
 *  the default `agentDistro` — OFF, on `vanilla` — onto a record that
 *  has none, so an existing install keeps exactly the PATH it had until the user
 *  turns Agents on; a record that already carries one (a re-run, or a value
 *  written by a newer build) is returned untouched, so a user's choice is never
 *  reset. The seed is spelled here rather than read off `DEFAULT_PREFERENCES`,
 *  whose default moved at 1.38: a rung says what ITS version did. Exported for
 *  `state.test.ts`. */
export function migratePreferences_1_37_0(
  current: Record<string, unknown>,
): Record<string, unknown> {
  if ("agentDistro" in current) return current;
  return {
    ...current,
    agentDistro: { enabled: false, profile: "vanilla" },
  };
}

/** 1.38.0 — "never chosen" became the ABSENCE of an Agents value (`null`); it
 *  decides the welcome step's autofocus and Settings' "nothing chosen yet"
 *  line. A stored `agentDistro` with `enabled: false` becomes `null`; one with
 *  `enabled: true` is kept whole. The Agents setting never shipped in a release
 *  before this (1.37's seed sat in unreleased work), so an Off record on disk is
 *  either that seed or a development build's choice — and treating that person
 *  as one who has not chosen yet is the honest outcome. Exported for
 *  `state.test.ts`. */
export function migratePreferences_1_38_0(
  current: Record<string, unknown>,
): Record<string, unknown> {
  const stored = current.agentDistro as { enabled?: unknown } | null;
  if (stored === null || stored === undefined || stored.enabled === true)
    return current;
  return { ...current, agentDistro: null };
}

/** 1.39.0 — the tile tip's size joined preferences. Seeds `tipBarCollapsed:
 *  false` (the full bar, as the tip first shipped) onto a record that has
 *  none; a record that already carries one is returned untouched. Spelled
 *  here rather than read off `DEFAULT_PREFERENCES`: a rung says what ITS
 *  version did. Exported for `state.test.ts`. */
export function migratePreferences_1_39_0(
  current: Record<string, unknown>,
): Record<string, unknown> {
  if ("tipBarCollapsed" in current) return current;
  return { ...current, tipBarCollapsed: false };
}

/** 1.40.0 — the Agents profile field remembers what was set
 *  (`agentProfilesRecent`, seeded empty onto a record that has none), and
 *  agent-distro no longer ships a `juspay` bundle: Juspay's profile is the
 *  reference `github:juspay/skills`, so a stored `juspay` becomes it, on or
 *  off. Exported for `state.test.ts`. */
export function migratePreferences_1_40_0(
  current: Record<string, unknown>,
): Record<string, unknown> {
  const stored = current.agentDistro as
    | { enabled: boolean; profile: string }
    | null
    | undefined;
  return {
    ...current,
    ...(stored?.profile === "juspay"
      ? { agentDistro: { ...stored, profile: "github:juspay/skills" } }
      : {}),
    agentProfilesRecent: current.agentProfilesRecent ?? [],
  };
}

/** 1.41.0 — agent-distro is one package, and the Agents setting's single
 *  `profile` became `profiles`, the stack over it. On or off is kept; `null`
 *  (never chosen) stays `null`, and a record already in the new shape is
 *  returned untouched. `vanilla` — the one bundle kolu shipped, the harnesses
 *  with no profile — is the empty stack; any other value was a reference, and
 *  is the stack's one entry (Juspay's leaves it at 1.42.0). Exported for
 *  `state.test.ts`. */
export function migratePreferences_1_41_0(
  current: Record<string, unknown>,
): Record<string, unknown> {
  const stored = current.agentDistro as
    | { enabled: boolean; profile: string }
    | { enabled: boolean; profiles: string[] }
    | null
    | undefined;
  if (stored === null || stored === undefined || !("profile" in stored))
    return current;
  return {
    ...current,
    agentDistro: {
      enabled: stored.enabled,
      profiles: stored.profile === "vanilla" ? [] : [stored.profile],
    },
  };
}

/** 1.42.0 — Juspay is an explicit opt-in: `github:juspay/skills` leaves the
 *  stack, and `agentProfilesRecent` (it is always the add field's first
 *  suggestion, and never remembered). Between #2279 and #2287 it was the NEVER-CHOSEN default,
 *  so turning the switch on stored it with nobody picking it, and nothing on
 *  disk tells that apart from a pick — a value that may be a default never
 *  stays an entry; one click adds it back. The setting never shipped in a
 *  release, so only development builds wrote it. Exported for
 *  `state.test.ts`. */
export function migratePreferences_1_42_0(
  current: Record<string, unknown>,
): Record<string, unknown> {
  const juspay = "github:juspay/skills";
  const stored = current.agentDistro as
    | { enabled: boolean; profiles: string[] }
    | null
    | undefined;
  const recent = current.agentProfilesRecent as string[] | undefined;
  return {
    ...current,
    ...(stored === null || stored === undefined
      ? {}
      : {
          agentDistro: {
            ...stored,
            profiles: stored.profiles.filter((p) => p !== juspay),
          },
        }),
    ...(recent === undefined
      ? {}
      : { agentProfilesRecent: recent.filter((p) => p !== juspay) }),
  };
}

/** 1.43.0 — the host-tab arrangement joined preferences. Seeds `hostOrder: []`
 *  (nobody has rearranged yet, so the strip stays in pool order with the local
 *  host first) onto a record that has none; a record that already carries one
 *  is returned untouched. Spelled here rather than read off
 *  `DEFAULT_PREFERENCES`: a rung says what ITS version did. Exported for
 *  `state.test.ts`. */
export function migratePreferences_1_43_0(
  current: Record<string, unknown>,
): Record<string, unknown> {
  if ("hostOrder" in current) return current;
  return { ...current, hostOrder: [] };
}

/** 1.66.0 — where the Conductor compacts its conversation joined preferences.
 *  Seeds `conductorCompactsAt: 200000` (the count every earlier build used, a
 *  module constant until then) onto a record that has none; a record that
 *  already carries one is returned untouched. Spelled here rather than read off
 *  `DEFAULT_PREFERENCES`: a rung says what ITS version did. Exported for
 *  `state.test.ts`. */
export function migratePreferences_1_66_0(
  current: Record<string, unknown>,
): Record<string, unknown> {
  if ("conductorCompactsAt" in current) return current;
  return { ...current, conductorCompactsAt: 200000 };
}

/** 1.32.0 — the new-terminal collapsed DEFAULT moved off `rightPanel.collapsed`
 *  (a write-dead seed jammed next to live geometry) to a top-level
 *  `newTerminalCollapsed` preference beside `newTerminalTheme`. CARRY the old
 *  global `rightPanel.collapsed` value forward into the new top-level field —
 *  the field renamed home, the intent did not, so a user who kept the panel
 *  collapsed keeps that as their new-terminal seed rather than silently
 *  resetting to open on upgrade (this mirrors `migratePreferences_1_30_0`,
 *  which likewise derives its new field from the old value). Then strip the
 *  stale `rightPanel.collapsed` key so the blob matches the schema exactly. The
 *  record's live geometry (`size`/`codeTabTreeSize`) and every unrelated
 *  preference are preserved verbatim; a record with no `rightPanel` at all just
 *  gains the top-level default and is otherwise untouched.
 *
 *  Exported so `state.test.ts` can exercise the conversion directly without
 *  spinning up a `Conf` store under `KOLU_STATE_DIR`. */
export function migratePreferences_1_32_0(
  current: Record<string, unknown>,
): Record<string, unknown> {
  // Shape-guard before trusting `rightPanel` as a record: a corrupt blob could
  // carry a non-object there, and the destructure below would otherwise treat a
  // string/number as one.
  const rp =
    typeof current.rightPanel === "object" && current.rightPanel !== null
      ? (current.rightPanel as Record<string, unknown>)
      : undefined;
  const { collapsed: prevCollapsed, ...restRp } = rp ?? {};
  return {
    ...DEFAULT_PREFERENCES,
    ...current,
    // The carry-forward, placed after the spreads so it wins over the default
    // `newTerminalCollapsed`. Falls back to the default only when the old value
    // was absent or not a boolean.
    newTerminalCollapsed:
      typeof prevCollapsed === "boolean"
        ? prevCollapsed
        : DEFAULT_PREFERENCES.newTerminalCollapsed,
    ...(rp !== undefined && { rightPanel: restRp }),
  };
}

/** 1.34.0 — the `activityAlerts` preference was renamed to `attentionAlerts`
 *  (terminology standardization on "attention"; same boolean meaning, same
 *  `true` default). CARRY the old value forward: a user who turned alerts OFF
 *  keeps them off rather than silently reverting to the default on upgrade.
 *  The legacy `activityAlerts` key is dropped so the blob matches the schema
 *  exactly.
 *
 *  Keyed off the PRESENCE of the legacy key, which ALWAYS wins over an
 *  `attentionAlerts` already sitting on the record — the same legacy-field-wins
 *  rule `migratePreferences_1_30_0` states, and for the same reason. A pre-1.34
 *  blob reaches this step having walked every spread-`DEFAULT_PREFERENCES` rung
 *  below it (1.3.0, 1.4.0, 1.6.0, 1.7.0, 1.10.0, 1.32.0), each of which injects
 *  TODAY's `attentionAlerts: true` into whatever it touches — so the new key's
 *  mere presence proves nothing about user intent, while the legacy key's
 *  presence does. A record carrying a genuinely user-chosen `attentionAlerts`
 *  has by definition already run this step, and this step drops
 *  `activityAlerts`, so the legacy key can never reappear to outrank it.
 *
 *  Exported so `state.test.ts` can exercise the conversion directly without
 *  spinning up a `Conf` store under `KOLU_STATE_DIR`. */
export function migratePreferences_1_34_0(
  current: Record<string, unknown>,
): Record<string, unknown> {
  const { activityAlerts, ...rest } = current;
  // Overwriting an existing `attentionAlerts` through the spread keeps that
  // key's original position, so a record that only ever had the default
  // injected changes one VALUE on disk rather than being reordered.
  if (typeof activityAlerts === "boolean")
    return { ...rest, attentionAlerts: activityAlerts };
  // Already migrated (a fresh ≥1.34 record), or default-injected by an earlier
  // rung with no legacy key left to correct it — either way the value stands.
  if (typeof rest.attentionAlerts === "boolean") return rest;
  // ALWAYS produce a boolean `attentionAlerts`. A blob that never explicitly set
  // `activityAlerts` (relied on the old default) must NOT migrate to a MISSING
  // `attentionAlerts`: `confStore` reads the raw object with no schema-default
  // back-fill, so an absent key surfaces as `undefined` on the client and
  // silently disables ALL attention alerts.
  return { ...rest, attentionAlerts: DEFAULT_PREFERENCES.attentionAlerts };
}

/** Delete a key that is no longer in `PersistedStateSchema` off the raw store —
 *  the conf-ladder idiom for stripping a legacy/orphan key (Conf's typed
 *  `delete` rejects keys outside the current schema, hence the double-cast).
 *  Harmless when the key is absent. */
function deleteLegacyKey(store: Conf<PersistedState>, key: string): void {
  (store as unknown as { delete: (key: string) => void }).delete(key);
}

/** Move a value off a key that is no longer in `PersistedStateSchema` onto the
 *  key that replaced it — the conf-ladder idiom for RENAMING one. The source
 *  key is outside the typed schema, so the raw store is reached the same way
 *  {@link deleteLegacyKey} reaches it.
 *
 *  The value crosses VERBATIM: a rename is not a shape change, and the
 *  destination's own reader re-validates what it finds (and crashes naming the
 *  file if it is wrong), so decoding here would only move that check earlier
 *  and turn a readable record into a failed boot.
 *
 *  THE LEGACY KEY'S PRESENCE IS THE WHOLE TEST, and it has to be: `conf`
 *  merges `defaults` into every read, so the destination always LOOKS
 *  present and "write it only if absent" would never write at all. It is
 *  also the right test on its own terms — a file still carrying the old key
 *  has not walked this rung, so what sits under the new name is either
 *  nothing or the empty record the previous rung seeded, and the old key is
 *  the only real conversation on the disk. The legacy key is then deleted, so
 *  a second walk finds nothing to move and no stale copy is left behind. */
function renameLegacyKey(
  store: Conf<PersistedState>,
  from: string,
  to: keyof PersistedState & string,
): void {
  // The one unchecked step, named: Conf's typed accessors reject `from`
  // outright, and this is the only reader of a key the schema has retired.
  const raw = store as unknown as {
    get: (key: string) => unknown;
    set: (key: string, value: unknown) => void;
  };
  const held = raw.get(from);
  if (held !== undefined) raw.set(to, held);
  deleteLegacyKey(store, from);
}

/** The keys the 1.31.0 BURIAL strips off this store — `session`/`activityFeed`
 *  (moved to padi's state-root at W2.2) plus the older orphan
 *  `sleepingTerminals`/`lastPairedDaemon` present on real disks from earlier
 *  eras. */
const LEGACY_KEYS_STRIPPED_1_31_0 = [
  "session",
  "activityFeed",
  "sleepingTerminals",
  "lastPairedDaemon",
] as const;

/** The 1.31.0 BURIAL migration body — BACKUP-FIRST, then strip.
 *
 *  A direct pre-W2.2 → W2.3 upgrade runs this ladder BEFORE a fresh padi's
 *  one-shot legacy import reads `$KOLU_STATE_DIR`, so an UNCONDITIONAL strip
 *  would destroy the legacy `session` before padi ever reads it. When ANY legacy
 *  key is present, byte-copy the whole config aside to a sibling
 *  `config.json.pre-1.31-strip.bak` FIRST (a wrong strip stays recoverable),
 *  THEN delete the keys. The copy is skipped when no legacy key is present, so a
 *  clean ≥W2.2 file grows no stray `.bak`.
 *
 *  The backup is WRITE-ONCE. `conf` persists each `delete` synchronously but only
 *  records the migration as done AFTER this handler returns, so a crash mid-strip
 *  (backup taken, some keys already deleted) leaves the migration to RERUN on the
 *  next boot — where the now-partially-stripped live file still trips `hasLegacy`.
 *  Re-copying there would clobber the full first backup with a lossy one, breaking
 *  the zero-loss import. So we keep the existing `.bak`: the first copy — taken
 *  before ANY delete — is always the complete pre-strip file, and every later copy
 *  could only be lossier.
 *
 *  Exported so a test can drive it against a real `Conf` under an ephemeral
 *  `KOLU_STATE_DIR` without walking the whole ladder. */
export function stripLegacyStateKeys_1_31_0(store: Conf<PersistedState>): void {
  const raw = store.store as unknown as Record<string, unknown>;
  const hasLegacy = LEGACY_KEYS_STRIPPED_1_31_0.some((key) => key in raw);
  const bakPath = `${store.path}.pre-1.31-strip.bak`;
  if (hasLegacy && !existsSync(bakPath)) {
    // Back up the whole config file BEFORE any delete, so a fresh padi's legacy
    // import (or a human) can still recover the pre-strip session. Write-once (see
    // the doc comment): a rerun after a partial strip must NOT overwrite the full
    // first backup with a lossy one.
    copyFileSync(store.path, bakPath);
  }
  for (const key of LEGACY_KEYS_STRIPPED_1_31_0) deleteLegacyKey(store, key);
}

/** ONE WATCH-LIST ENTRY as the 1.49.0 shape left it — the input the 1.50.0
 *  rung reads. Spelled HERE, as frozen history, rather than imported from
 *  `kolu-conductor`: that package no longer has a watch list, and a rung must
 *  keep reading the file the build before it wrote long after the live code
 *  has moved on. */
interface WatchedEntry_1_49_0 {
  readonly ref: string;
  readonly name: string;
  readonly agent: string | null;
  readonly told: string | null;
  readonly joined: string;
  readonly spoken: boolean;
  readonly ran: boolean;
  readonly since: string;
  readonly root: { readonly ref: string; readonly name: string } | null;
}

/** THE GROUPING THE 1.50.0 RUNG CHOOSES, and why it is the only honest one.
 *
 *  Before this rung a piece of work was GUESSED from the watch list: entries
 *  whose terminals shared a top-level ancestor were drawn as one card. That
 *  guess is on disk as `entry.root` — so the key is `entry.root?.ref ??
 *  entry.ref`, which is EXACTLY what the panel showed as one piece of work on
 *  the build that wrote the file. A person's four carried-over terminals come
 *  back arranged the way they left them; an entry no host had answered about
 *  (`root: null`) becomes its own work, which is also what it was drawn as.
 *
 *  Everything the record now wants and that file never had is written as the
 *  least it can claim:
 *  - `repo`/`branch` are "" — nothing wrote them down, and inventing a path
 *    would put a wrong address on the card;
 *  - every member's role is `other` — the roles arrived with this PR, and
 *    `other` is precisely "a terminal the human asked kolu to keep an eye on";
 *  - `mode` and `host` are DECISIONS, because `modeOf`/`hostOf` read decisions
 *    and a second copy of a setup is the thing the model refuses to have. They
 *    are answered `from: null`: nobody was asked, in the card or the chat or
 *    the request — the file is where they come from;
 *  - the timeline opens with `carried-over` (by kolu), then one `joined` per
 *    member, so a card that shows an empty history is impossible;
 *  - `startedAt` is the EARLIEST `since` in the group: the age a person was
 *    already being shown, kept rather than restarted at this boot.
 *
 *  FROZEN HISTORY, not a call into `kolu-work`'s transitions: these values are
 *  what completes the files this shape was written by, and they stay as they
 *  are when the live code's own empty values move.
 *
 *  TWO KEYS COME OUT OF ONE WATCH LIST, because that is what the entry always
 *  was: the half about the WORK (who its members are, when they joined) is a
 *  work, and the half about the TERMINAL (what it was called, what the
 *  conversation was told) is the `members` map, keyed by the same fleet ref
 *  the member names. An entry's two halves must land in both or a carried-over
 *  terminal comes back as one nobody has ever read — and rings about a state
 *  it was already told about.
 *
 *  Exported for `stateMigration.test.ts`, which drives it directly rather than
 *  through a whole ladder walk. */
export function worksFromWatched_1_50_0(
  watched: ReadonlyArray<WatchedEntry_1_49_0>,
  /** The work ids to mint, one per group, in group order — injected so a test
   *  can read the result without matching UUIDs. */
  mintId: () => string,
): {
  readonly works: ReadonlyArray<Record<string, unknown>>;
  readonly members: Record<string, Record<string, unknown>>;
} {
  const groups = new Map<string, WatchedEntry_1_49_0[]>();
  for (const entry of watched) {
    const key = entry.root?.ref ?? entry.ref;
    const group = groups.get(key);
    if (group === undefined) groups.set(key, [entry]);
    else group.push(entry);
  }
  const works: Record<string, unknown>[] = [];
  for (const [key, group] of groups) {
    const id = mintId();
    const first = group[0];
    if (first === undefined) continue;
    // ISO-8601 UTC strings sort lexically, which is why the record spells
    // times that way: the earliest `since` is a string comparison.
    const startedAt = group.reduce(
      (earliest, one) => (one.since < earliest ? one.since : earliest),
      first.since,
    );
    const rootName = group.find((one) => one.root !== null)?.root?.name ?? "";
    const title =
      rootName !== ""
        ? rootName
        : first.name !== ""
          ? first.name
          : "Carried over";
    // The host half of the group's ref (`<encodedHostKey>/<terminalId>`) — the
    // machine the work is on, which is the one setup answer the file does know.
    // Split at the LAST slash: a terminal id never holds one, and a host key
    // may (`remote:ssh://box`).
    const host = key.slice(0, key.lastIndexOf("/"));
    const carried = (key: string, value: string) => ({
      id: `${id}:${key}`,
      ask: `${id}:carried-over`,
      at: startedAt,
      key,
      // A setup decision: its label is the key's own name.
      header: "",
      question: "Carried over from before kolu stored work",
      options: [value],
      multiple: false,
      // A question about NO file: this one was never asked at all, and the
      // key exists because every decision carries it. Written here rather
      // than left to the record's decoding default so the file this rung
      // produces is today's shape whole, not a shape a reader completes.
      file: "",
      answer: {
        at: startedAt,
        how: "answered",
        picked: [value],
        text: null,
        // Nowhere: no card, no chat, no request. The file said it.
        from: null,
      },
    });
    works.push({
      id,
      title,
      repo: "",
      branch: "",
      members: group.map((one) => ({
        terminal: one.ref,
        role: "other",
        joinedAt: one.since,
        leftAt: null,
        // No worktree has been read for it yet; the first reading after the
        // boot says, and until then no files are listed or kept.
        worktree: null,
      })),
      events: [
        {
          at: startedAt,
          by: "kolu",
          kind: "carried-over",
          terminal: null,
          detail: "watched before kolu stored work",
        },
        ...group.map((one) => ({
          at: one.since,
          by: "kolu",
          kind: "joined",
          terminal: one.ref,
          detail: "other",
        })),
      ],
      decisions: [carried("mode", "watch"), carried("host", host)],
      startedAt,
      endedAt: null,
      outcome: null,
      keptFiles: [],
    });
  }
  // ... and what kolu knew about each of those terminals, under its own key.
  const members: Record<string, Record<string, unknown>> = {};
  for (const entry of watched) {
    members[entry.ref] = {
      name: entry.name,
      agent: entry.agent,
      told: entry.told,
      joined: entry.joined,
      spoken: entry.spoken,
      ran: entry.ran,
    };
  }
  return { works, members };
}

/** The 1.50.0 rung's body — A PIECE OF WORK IS A STORED THING, and the
 *  transcript is a file.
 *
 *  Two moves, in this order:
 *
 *  1. THE ROWS LEAVE `config.json`. `conf` rewrites the whole file on every
 *     `set`, and on a real machine the transcript was 90% of its bytes — so a
 *     keystroke re-serialized the fleet and the host map with it. They move to
 *     `<stateDir>/conductor/transcript.json`, stamped with
 *     {@link TRANSCRIPT_FILE_VERSION} and written through the same one writer
 *     the conversation uses (`conductor/transcriptFile.ts`, which states how
 *     that file is versioned: by THIS ladder, in a rung like this one). The
 *     key is then deleted — a stale copy left behind is a transcript a later
 *     reader could find and believe.
 *  2. THE WATCH LIST BECOMES WORKS AND MEMBERS
 *     ({@link worksFromWatched_1_50_0}), and the key is deleted. No watched
 *     terminal is lost: every entry comes back as a member of a work in
 *     progress, grouped as the panel that wrote the file drew it, and what
 *     kolu knew about that TERMINAL comes back under the `members` key keyed
 *     by the same ref — so a carried-over terminal is not rung about for a
 *     state the conversation was already told.
 *
 *  Exported so a test can drive it against a real `Conf` under a temp dir
 *  without walking the whole ladder — the shape `stripLegacyStateKeys_1_31_0`
 *  already uses. */
export function migrateConductorToWorks_1_50_0(
  store: Conf<PersistedState>,
): void {
  // Read as an OBJECT: this rung runs against a file written by an older
  // build, whose `conductor` key is exactly the shape the current schema no
  // longer accepts.
  const record = store.get("conductor") as Record<string, unknown> | undefined;
  if (record === undefined) return;
  const { rows, watched, ...rest } = record;
  // A `rows`/`watched` that is there and is not a list is not an older shape —
  // it is a broken file, left exactly as it is so the read refuses it by name
  // rather than this rung quietly dropping a conversation.
  if (rows !== undefined && !Array.isArray(rows)) return;
  if (watched !== undefined && !Array.isArray(watched)) return;
  if (rows !== undefined) {
    writeTranscriptFile(
      transcriptFilePath(dirname(store.path)),
      TRANSCRIPT_FILE_VERSION,
      rows,
    );
  }
  store.set("conductor", rest as unknown as PersistedState["conductor"]);
  const carried = worksFromWatched_1_50_0(
    (watched ?? []) as ReadonlyArray<WatchedEntry_1_49_0>,
    randomUUID,
  );
  store.set("works", carried.works as unknown as PersistedState["works"]);
  store.set("members", carried.members as unknown as PersistedState["members"]);
}

/** THE CHECK EVENT KINDS and the head commit their detail named, as 1.51.0
 *  read them. Frozen history: `kolu-work`'s events carry a typed `head` and a
 *  PR now and its `checkKey` takes both, while this rung runs against a file
 *  whose check events are a kind and a prose detail. */
const CHECK_KINDS_1_51_0: ReadonlySet<string> = new Set([
  "checks-running",
  "checks-passed",
  "checks-failed",
]);

const checkHead_1_51_0 = (detail: string): string | null =>
  /^([0-9a-f]{7,40})(?: |$)/.exec(detail)?.[1] ?? null;

/** The 1.51.0 rung's body — THE PING-PONG, SWEPT OUT OF THE SAVED WORKS.
 *
 *  Two members in one worktree both read the SAME pull request, thirty
 *  seconds out of step with each other, and the observer used to compare each
 *  reading with the last check event rather than with a fact about the PR. So
 *  while the two disagreed — one says the checks are running, one says they
 *  passed — every frame of the host appended another event, several a second.
 *  One real work carried 465 events, 429 of them that (juspay/kolu#2376).
 *
 *  WHAT THIS KEEPS: the FIRST check event of each kind for each head commit
 *  the detail names, in the order it was written, and every event that is not
 *  a check event untouched — the same rule the observer now applies as the
 *  readings arrive (`kolu-work`'s {@link checkKey}), run over what was
 *  already written. Nothing else about a work is read or rewritten.
 *
 *  Check events written BEFORE the head commit was recorded name none, so
 *  they all share one key and a work keeps the first `checks-running` and the
 *  first `checks-passed` it ever saw. That is the honest reading of a record
 *  that cannot say which push each line was about — and it is exactly what
 *  the ping-pong was: one PR, one commit, two readers.
 *
 *  Exported so a test can drive it against a real `Conf` under a temp dir
 *  without walking the whole ladder. */
export function collapseFlappingChecks_1_51_0(
  store: Conf<PersistedState>,
): void {
  // Read as OBJECTS: a rung runs against a file written by an older build,
  // and a work whose shape this build would refuse must still walk past.
  const works: unknown = store.get("works");
  if (!Array.isArray(works)) return;
  let swept = false;
  const next = works.map((work: unknown) => {
    if (typeof work !== "object" || work === null || !("events" in work))
      return work;
    const events = work.events;
    if (!Array.isArray(events)) return work;
    const seen = new Set<string>();
    const kept = events.filter((event: unknown) => {
      if (typeof event !== "object" || event === null) return true;
      if (!("kind" in event) || !("detail" in event)) return true;
      const { kind, detail } = event;
      if (typeof kind !== "string" || typeof detail !== "string") return true;
      if (!CHECK_KINDS_1_51_0.has(kind)) return true;
      const key = `${kind}@${checkHead_1_51_0(detail) ?? ""}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    if (kept.length === events.length) return work;
    swept = true;
    return { ...work, events: kept };
  });
  if (swept) store.set("works", next as unknown as PersistedState["works"]);
}

/** A record, as a rung reads one: an object with string keys, or nothing. */
const recordOf = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

/** The 1.52.0 rung's body — A STORE THIS BRANCH WROTE BEFORE THE MEMBER
 *  BOOKKEEPING MOVED OUT OF THE WORK (juspay/kolu#2376, round 3).
 *
 *  Commit `910515439` changed two saved shapes without a rung, because the
 *  version then still read 1.50.0 and the branch was treated as unreleased.
 *  It was not: a person had deployed an earlier commit, so their disk held
 *  works written at 1.50.0 in the earlier shape, and the reader refused them
 *  ("Missing key at [0]["members"][0]["worktree"]"). This rung takes that
 *  shape to the current one, and passes the current shape through untouched:
 *
 *  - a work member's `watch` bookkeeping moves to the top-level `members`
 *    record under the member's terminal — kept as it is if that terminal
 *    already has an entry there (the newer writer's word wins) — minus the
 *    `worktree` field, which is not watch bookkeeping;
 *  - the member gets `worktree`, from `watch.worktree`, else `null`;
 *  - `watch` is removed;
 *  - a decision gets the `header` and `file` it was written without (`""`
 *    both: a setup decision is named by its key, any other by its question,
 *    and no file was named).
 *
 *  ORDER WITH 1.51.0: the ladder runs in version order, so a store at 1.50.0
 *  meets the check sweep first and this rung second. That order is correct
 *  and so would be the other: the sweep reads only `events` (as untyped
 *  objects) and this rung never touches `events`, so neither depends on the
 *  other's output. Taking this as a new number rather than editing 1.50.0 or
 *  1.51.0 is the rule this round wrote into the state skill: a rung that has
 *  run on somebody's store is never edited.
 *
 *  Read as untyped objects throughout: a rung runs against a file an older
 *  build wrote, and must walk past anything it does not recognise. Exported
 *  for `stateMigration.test.ts`. */
export function memberWatchOutOfWorks_1_52_0(
  store: Conf<PersistedState>,
): void {
  const works: unknown = store.get("works");
  if (!Array.isArray(works)) return;
  const members: Record<string, unknown> = {
    ...(recordOf(store.get("members")) ?? {}),
  };
  let moved = false;
  const next = works.map((value: unknown) => {
    const work = recordOf(value);
    if (work === null) return value;
    const workMembers = Array.isArray(work.members) ? work.members : null;
    const decisions = Array.isArray(work.decisions) ? work.decisions : null;
    let changed = false;
    const nextMembers = workMembers?.map((one: unknown) => {
      const member = recordOf(one);
      if (member === null) return one;
      const watch = recordOf(member.watch);
      if (watch === null && "worktree" in member) return one;
      changed = true;
      const { watch: _watch, ...rest } = member;
      const worktree =
        typeof watch?.worktree === "string" ? watch.worktree : null;
      const terminal = member.terminal;
      if (watch !== null && typeof terminal === "string") {
        const { worktree: _worktree, ...bookkeeping } = watch;
        if (!(terminal in members)) members[terminal] = bookkeeping;
      }
      return {
        ...rest,
        worktree: "worktree" in rest ? rest.worktree : worktree,
      };
    });
    const nextDecisions = decisions?.map((one: unknown) => {
      const decision = recordOf(one);
      if (decision === null) return one;
      if ("header" in decision && "file" in decision) return one;
      changed = true;
      return { header: "", file: "", ...decision };
    });
    if (!changed) return value;
    moved = true;
    return {
      ...work,
      ...(nextMembers === undefined ? {} : { members: nextMembers }),
      ...(nextDecisions === undefined ? {} : { decisions: nextDecisions }),
    };
  });
  if (!moved) return;
  store.set("works", next as unknown as PersistedState["works"]);
  store.set("members", members as unknown as PersistedState["members"]);
}

/** ONE WORK as every shape up to 1.52.0 wrote it — the input this rung reads.
 *  Frozen history: `kolu-work` no longer has a work with an `id`, members
 *  inside it, a nullable `endedAt`/`outcome` pair or a `detail` string on an
 *  event, and a rung must keep reading what the build before it wrote. */
interface Work_1_52_0 {
  readonly id: string;
  readonly title: string;
  readonly repo: string;
  readonly branch: string;
  readonly members: ReadonlyArray<Record<string, unknown>>;
  readonly events: ReadonlyArray<Record<string, unknown>>;
  readonly decisions: ReadonlyArray<Record<string, unknown>>;
  readonly startedAt: string;
  readonly endedAt: string | null;
  readonly outcome: string | null;
  readonly keptFiles: ReadonlyArray<Record<string, unknown>>;
}

const text = (value: unknown): string =>
  typeof value === "string" ? value : "";

/** THE ANSWER a 1.52.0 decision came to, as one value — the frozen twin of
 *  `kolu-work`'s `answerValue`, reading the shape where an answer was a
 *  nullable field rather than an arm of a sum. */
const answered_1_52_0 = (
  decisions: ReadonlyArray<Record<string, unknown>>,
  key: string,
): string | null => {
  let value: string | null = null;
  for (const one of decisions) {
    if (one.key !== key) continue;
    const answer = recordOf(one.answer);
    if (answer === null || answer.how !== "answered") continue;
    const picked = Array.isArray(answer.picked) ? answer.picked : [];
    const first = typeof picked[0] === "string" ? picked[0] : null;
    const typed = typeof answer.text === "string" ? answer.text : null;
    value = first ?? typed;
  }
  return value;
};

/** The host half of a fleet terminal ref (`<host>/<id>`). */
const hostOfRef_1_53_0 = (ref: string): string | null => {
  const cut = ref.indexOf("/");
  return cut <= 0 ? null : ref.slice(0, cut);
};

/** THE WORK KEY AND ITS ENCODINGS as 1.53.0 wrote them. Frozen history: the
 *  live `kolu-work` is free to move its key shape, its id encoding and its
 *  directory hash, and this rung has to keep producing the bytes it was
 *  proven against — the same lesson the 1.51.0 rung above learned when
 *  `kolu-work`'s check events grew a typed head. `stateLadderFrozen.test.ts`
 *  pins these against the live ones for as long as the two agree. */
export type WorkKey_1_53_0 =
  | {
      readonly kind: "branch";
      readonly host: string;
      readonly repo: string;
      readonly branch: string;
    }
  | { readonly kind: "watch"; readonly terminal: string };

/** Percent-encode everything that could be confused with the separators, so
 *  the encoding is injective. */
const part_1_53_0 = (value: string): string => encodeURIComponent(value);

/** THE ONE STRING ENCODING OF A KEY, as 1.53.0 wrote the ids of the works it
 *  folded. */
export const workIdOf_1_53_0 = (key: WorkKey_1_53_0): string =>
  key.kind === "branch"
    ? `branch:${part_1_53_0(key.host)}/${part_1_53_0(key.repo)}/${part_1_53_0(key.branch)}`
    : `watch:${part_1_53_0(key.terminal)}`;

/** THE DIRECTORY A WORK'S KEPT FILES SIT IN, under `<stateRoot>/works/`, as
 *  1.53.0 named the directories it MOVED FILES INTO: FNV-1a over the id's
 *  code units, twice (two 32-bit rounds seeded differently) for a 64-bit
 *  name. */
export const workDirOf_1_53_0 = (id: string): string => {
  const fnv = (seed: number): string => {
    let hash = seed;
    for (let at = 0; at < id.length; at += 1) {
      hash ^= id.charCodeAt(at);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash.toString(16).padStart(8, "0");
  };
  return `${fnv(0x811c9dc5)}${fnv(0x7fffffff)}`;
};

/** THE VERSION 1.53.0 STAMPED INTO THE TRANSCRIPT FILE it rewrote. Frozen for
 *  the same reason: the live `TRANSCRIPT_FILE_VERSION` moves to the number of
 *  the next rung that changes the row shape, and such a rung may decline to
 *  rewrite a file (this one has two early returns of its own), so reading it
 *  live would let this rung stamp a 1.53-shaped file with a future version —
 *  a stamp is refused by name, never guessed at. */
const TRANSCRIPT_VERSION_1_53_0 = "1.53.0";

/** WHAT A WORK WRITTEN BEFORE 1.53.0 IS A WORK ABOUT — its key, or nothing.
 *
 *  The host comes from the latest answered `host` decision (it was a setup
 *  question then), and failing that from a member's own terminal ref: a work
 *  whose setup was declined still RAN on the machine its terminals are on,
 *  and that is the honest reading. A `watch` is keyed by the terminal it
 *  watches. Nothing resolvable, nothing to key it by. */
const keyOf_1_53_0 = (work: Work_1_52_0): WorkKey_1_53_0 | null => {
  const mode = answered_1_52_0(work.decisions, "mode");
  const terminals = work.members
    .map((one) => text(one.terminal))
    .filter((ref) => ref !== "");
  if (mode === "watch" || (work.repo === "" && work.branch === "")) {
    const terminal = terminals[0];
    return terminal === undefined ? null : { kind: "watch", terminal };
  }
  const host =
    answered_1_52_0(work.decisions, "host") ??
    (terminals[0] === undefined ? null : hostOfRef_1_53_0(terminals[0]));
  if (host === null || work.repo === "" || work.branch === "") return null;
  return { kind: "branch", host, repo: work.repo, branch: work.branch };
};

/** The pull request a `#<number> …` detail names. */
const prOf_1_53_0 = (detail: string): number | null => {
  const number = Number(/^#(\d+)/.exec(detail)?.[1]);
  return Number.isInteger(number) ? number : null;
};

/** ONE 1.52.0 EVENT, as the typed event that says the same thing — or
 *  nothing, for the three lines that cannot be said any more:
 *
 *   - a check event whose work has no pull request in its timeline before it
 *     (the new event carries the PR, and inventing one would be a lie);
 *   - a `merged`/`pr-closed` whose detail names no number;
 *   - an `ended abandoned`, because there is no such ending: the work it is
 *     on becomes Open, and a line saying kolu gave up on it would be the
 *     screenshot this round exists to delete.
 *
 *  `pr` is the number the timeline has reached, threaded by the caller. */
const eventOf_1_53_0 = (
  event: Record<string, unknown>,
  pr: number | null,
): Record<string, unknown> | null => {
  const kind = text(event.kind);
  const detail = text(event.detail);
  const base = {
    at: text(event.at),
    by: text(event.by),
    terminal: typeof event.terminal === "string" ? event.terminal : null,
    kind,
  };
  switch (kind) {
    case "requested":
    case "note":
      return { ...base, text: detail };
    case "carried-over":
    case "taken-over":
    case "handed-back":
    case "reopened":
      return base;
    case "joined":
      return {
        ...base,
        role: ["planner", "implementor", "other"].includes(detail)
          ? detail
          : "other",
      };
    case "left":
      return {
        ...base,
        why: ["closed", "released", "gone"].includes(detail) ? detail : "gone",
      };
    case "ready":
    case "stopped":
    case "asking":
    case "exited":
    case "asleep":
    case "keep-failed":
      return { ...base, why: detail };
    case "file":
      return { ...base, path: detail };
    case "question":
    case "answered":
    case "question-dropped":
      return { ...base, ask: detail };
    case "pr-opened": {
      const number = prOf_1_53_0(detail);
      return number === null
        ? null
        : { ...base, pr: number, title: detail.replace(/^#\d+\s*/, "") };
    }
    case "merged":
    case "pr-closed": {
      const number = prOf_1_53_0(detail) ?? pr;
      return number === null ? null : { ...base, pr: number };
    }
    case "checks-running":
    case "checks-passed":
    case "checks-failed": {
      if (pr === null) return null;
      const head = checkHead_1_51_0(detail);
      const rest =
        head === null ? detail : detail.slice(head.length).trimStart();
      return {
        ...base,
        pr,
        head,
        failing:
          kind === "checks-failed" && rest !== "" ? rest.split(", ") : [],
      };
    }
    case "kept":
    case "folded": {
      const count = Number(detail);
      return { ...base, count: Number.isInteger(count) ? count : 0 };
    }
    default:
      return null;
  }
};

/** The 1.53.0 rung's body — THREE CARDS FOR ONE BRANCH BECOME ONE WORK.
 *
 *  A work used to be a minted id, so opening the same branch again made a
 *  second work with the same repo, the same branch and the same two
 *  terminals; a work whose members had all gone was ended `abandoned`, which
 *  is what made the Conductor open the next one. The model now says a work IS
 *  its branch ({@link WorkKey_1_53_0}, the key as this rung froze it), so this
 *  rung folds what is on disk into that shape:
 *
 *  - EVERY WORK IS KEYED ({@link keyOf_1_53_0}): host from the latest answered
 *    `host` decision, else from a member's own terminal; repo and branch as
 *    they stand; a `watch` by the terminal it watches. A work whose key
 *    cannot be resolved has no members at all — there is no host to keep and
 *    nothing to key it by — so it is DROPPED.
 *  - WORKS WITH ONE KEY BECOME ONE. The earliest is the work (its title, its
 *    `startedAt`); the later ones contribute every decision, and every event
 *    the first does not already hold (the same kind at the same instant on
 *    the same terminal with the same detail is the same observation seen
 *    twice), merged in time order. The decision LOG keeps all of them, so the
 *    latest answer per setup key is what `setupOf` reads back — which is the
 *    reading rule, unchanged.
 *  - `host` DECISIONS ARE DROPPED: the host is the key now, and a question
 *    whose answer is part of the identity is a second copy of it.
 *  - `abandoned` DOES NOT EXIST, so such a work becomes OPEN, with its
 *    `ended` line taken off the timeline. `merged`/`closed` become an Ended
 *    state carrying the PR number the timeline names.
 *  - MEMBERS RE-KEY INTO THE ONE MAP, by terminal: the latest row for that
 *    terminal in the group wins, one that had left stays gone, and the watch
 *    bookkeeping already under the top-level `members` key rides along in the
 *    same row. A second terminal in a role the work already has is left out
 *    rather than written down — `parseStore` would refuse the store, and the
 *    reader a person is waiting for must come up.
 *  - EVENTS BECOME TYPED ({@link eventOf_1_53_0}): a check event with no PR in
 *    its timeline is dropped, and so is a line nothing can say any more.
 *  - THE TIMELINE SAYS EACH THING ONCE. Three works on one branch each watched
 *    the same `.waterfall/` fill up, so the naive union lists every document
 *    twenty-odd times; a `file` event is news that a path EXISTS, so only the
 *    first one for a path is kept. `kept` events are dropped from a work that
 *    comes out OPEN: kept files are what an ENDED work left behind, and this
 *    work is in progress — its files are still in its worktree.
 *
 *  Answers the MOVES the caller owes the kept files: every folded work's old
 *  directory (`<works>/<old id>`) into the one new
 *  `<works>/<workDirOf_1_53_0(id)>`, oldest-ending first, so where two old
 *  works kept the same path the newest copy is the one that survives the
 *  merge.
 *
 *  PURE, and exported for `stateMigration.test.ts` and the proof against the
 *  human's own store: a rung this size has to be runnable without a `Conf`. */
export function foldWorksByKey_1_53_0(
  works: ReadonlyArray<unknown>,
  was: Record<string, unknown>,
): {
  readonly works: Record<string, unknown>;
  readonly members: Record<string, unknown>;
  readonly moves: ReadonlyArray<{ readonly from: string; readonly to: string }>;
} {
  const groups = new Map<string, Array<Work_1_52_0>>();
  for (const value of works) {
    const record = recordOf(value);
    if (record === null) continue;
    const work: Work_1_52_0 = {
      id: text(record.id),
      title: text(record.title),
      repo: text(record.repo),
      branch: text(record.branch),
      members: (Array.isArray(record.members) ? record.members : [])
        .map(recordOf)
        .filter((one): one is Record<string, unknown> => one !== null),
      events: (Array.isArray(record.events) ? record.events : [])
        .map(recordOf)
        .filter((one): one is Record<string, unknown> => one !== null),
      decisions: (Array.isArray(record.decisions) ? record.decisions : [])
        .map(recordOf)
        .filter((one): one is Record<string, unknown> => one !== null),
      startedAt: text(record.startedAt),
      endedAt: typeof record.endedAt === "string" ? record.endedAt : null,
      outcome: typeof record.outcome === "string" ? record.outcome : null,
      keptFiles: (Array.isArray(record.keptFiles) ? record.keptFiles : [])
        .map(recordOf)
        .filter((one): one is Record<string, unknown> => one !== null),
    };
    const key = keyOf_1_53_0(work);
    if (key === null) continue;
    const id = workIdOf_1_53_0(key);
    const group = groups.get(id) ?? [];
    group.push(work);
    groups.set(id, group);
  }
  const folded: Record<string, unknown> = {};
  const members: Record<string, unknown> = {};
  const moves: Array<{ from: string; to: string }> = [];
  for (const [id, group] of groups) {
    const inOrder = [...group].sort((a, b) =>
      a.startedAt < b.startedAt ? -1 : a.startedAt > b.startedAt ? 1 : 0,
    );
    const first = inOrder[0];
    if (first === undefined) continue;
    const key = keyOf_1_53_0(first);
    if (key === null) continue;
    const decisions = inOrder
      .flatMap((one) => one.decisions)
      .filter((one) => one.key !== "host")
      .map((one) => {
        const { answer, ...rest } = one;
        const given = recordOf(answer);
        return given === null
          ? { kind: "asked", ...rest }
          : { kind: "answered", ...rest, answer: given };
      });
    const seen = new Set<string>();
    const timeline: Array<Record<string, unknown>> = [];
    for (const one of inOrder) {
      for (const event of one.events) {
        const signature = `${text(event.kind)}|${text(event.at)}|${text(event.terminal)}|${text(event.detail)}`;
        if (seen.has(signature)) continue;
        seen.add(signature);
        timeline.push(event);
      }
    }
    timeline.sort((a, b) =>
      text(a.at) < text(b.at) ? -1 : text(a.at) > text(b.at) ? 1 : 0,
    );
    // THE OUTCOME IS WHAT THE FORGE SAID, never what kolu failed to see: an
    // `abandoned` work (and a group where every member merely went away) is
    // open again.
    const ending = inOrder.findLast(
      (one) => one.outcome === "merged" || one.outcome === "closed",
    );
    let pr: number | null = null;
    const events: Array<Record<string, unknown>> = [];
    // The observer's own rules, applied to what the folded works observed
    // SEPARATELY: a pull request is opened once however many works watched it
    // open, and a check event is news about one PR at one commit. Three works
    // on one branch each saw #181 open; one timeline says it once.
    const checks = new Set<string>();
    // ONE LINE PER PATH. A `file` event says a document EXISTS in the work's
    // `.waterfall/`; three works watching one worktree each said it as they
    // found it, so the union repeats every plan and note once per card. The
    // first sighting is the true one — it is when the file appeared.
    const paths = new Set<string>();
    for (const event of timeline) {
      if (text(event.kind) === "ended" && ending === undefined) continue;
      const typed = eventOf_1_53_0(event, pr);
      if (typed === null) continue;
      // KEPT FILES BELONG TO AN ENDED WORK. This group's `kept` lines were
      // written by the `abandoned` endings this rung takes back, so a work
      // that comes out OPEN would carry a "kolu kept 20 files" line about
      // files that are still sitting in its worktree.
      if (typed.kind === "kept" && ending === undefined) continue;
      if (typed.kind === "file") {
        const path = text(typed.path);
        if (paths.has(path)) continue;
        paths.add(path);
      }
      if (typed.kind === "pr-opened" && typeof typed.pr === "number") {
        if (typed.pr === pr) continue;
        pr = typed.pr;
      }
      if (
        typeof typed.kind === "string" &&
        CHECK_KINDS_1_51_0.has(typed.kind)
      ) {
        const key = `${typed.kind}#${String(typed.pr)}@${typed.head ?? ""}`;
        if (checks.has(key)) continue;
        checks.add(key);
      }
      if (typed.kind === "ended") {
        if (ending === undefined) continue;
        typed.outcome = {
          kind: ending.outcome === "merged" ? "merged" : "closed",
          pr: pr ?? 0,
        };
      }
      events.push(typed);
    }
    const state =
      ending === undefined
        ? { kind: "open" }
        : {
            kind: "ended",
            at: ending.endedAt ?? first.startedAt,
            outcome: {
              kind: ending.outcome === "merged" ? "merged" : "closed",
              pr: pr ?? 0,
            },
            kept: ending.keptFiles,
          };
    folded[id] = {
      key,
      title: first.title,
      startedAt: first.startedAt,
      decisions,
      events,
      state,
    };
    // THE KEPT FILES FOLLOW THE WORK. Every old work in the group had its own
    // directory under `works/`, named by the id it no longer has; all of them
    // merge into the one the folded work names. Oldest ENDING first, so where
    // two of them kept the same path the newest copy is what is left.
    for (const one of [...inOrder].sort((a, b) =>
      (a.endedAt ?? a.startedAt) < (b.endedAt ?? b.startedAt) ? -1 : 1,
    ))
      moves.push({ from: one.id, to: workDirOf_1_53_0(id) });
    if (state.kind !== "open") continue;
    // The LATEST row per terminal across the group is the membership: a
    // terminal that left and joined again is in the work it joined last, and
    // one whose last row says it left is not a member at all.
    const latest = new Map<string, Record<string, unknown>>();
    for (const one of inOrder)
      for (const member of one.members) {
        const ref = text(member.terminal);
        if (ref === "") continue;
        const held = latest.get(ref);
        if (held === undefined || text(held.joinedAt) <= text(member.joinedAt))
          latest.set(ref, member);
      }
    const roles = new Set<string>();
    for (const [ref, member] of latest) {
      if (member.leftAt !== null && member.leftAt !== undefined) continue;
      const role = text(member.role) === "" ? "other" : text(member.role);
      if (role !== "other" && roles.has(role)) continue;
      roles.add(role);
      members[ref] = {
        work: id,
        role,
        joinedAt: text(member.joinedAt),
        worktree: typeof member.worktree === "string" ? member.worktree : null,
        watch: recordOf(was[ref]) ?? {
          name: "",
          agent: null,
          told: null,
          joined: "asked",
          spoken: false,
          ran: false,
        },
      };
    }
  }
  return { works: folded, members, moves };
}

/** THE KEPT-FILE DIRECTORIES, MOVED — `<root>/<old work id>` into
 *  `<root>/<workDirOf_1_53_0(new id)>`, in the order the fold gives them
 *  (oldest ending first), merging rather than refusing: where two of the
 *  folded works kept the same path the later move overwrites it, so the copy
 *  that survives is the newest one, and each such collision is logged with
 *  the path and the work it came from. The old directory is removed once its
 *  contents are in the new one — leaving it would be an orphan the sweep
 *  deletes anyway.
 *
 *  Exported for the migration test, which drives it against real directories
 *  under a temp state root. */
export function moveKeptFiles_1_53_0(
  root: string,
  moves: ReadonlyArray<{ readonly from: string; readonly to: string }>,
): void {
  for (const { from, to } of moves) {
    if (from === to) continue;
    const source = join(root, from);
    const target = join(root, to);
    if (!existsSync(source)) continue;
    if (!existsSync(target)) {
      mkdirSync(target, { recursive: true, mode: 0o700 });
    } else {
      for (const path of keptPathsUnder_1_53_0(source, ""))
        if (existsSync(join(target, path)))
          log.info(
            { work: from, path },
            "state: two folded works kept the same file — keeping the newer copy",
          );
    }
    cpSync(source, target, { recursive: true, force: true });
    rmSync(source, { recursive: true, force: true });
  }
}

/** Every FILE under a kept-files directory, as paths relative to it. */
const keptPathsUnder_1_53_0 = (dir: string, prefix: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? keptPathsUnder_1_53_0(join(dir, entry.name), `${prefix}${entry.name}/`)
      : [`${prefix}${entry.name}`],
  );

/** The 1.53.0 rung, against the store — the fold above, the kept files moved
 *  into the folded works' directories, and the transcript file's work
 *  questions split into their own row kind ({@link TRANSCRIPT_FILE_VERSION}
 *  moves with it: a row shape change is a rung here, by this file's own rule).
 *
 *  THIS RUNG IS WHERE THE REPAIRS GO, and the reason is dates: the human's
 *  live store is still at 1.52.0 (the copy this round was proven on,
 *  `config-3-works-all-ended.json`, is stamped 1.52.0), so 1.53.0 has run on
 *  no person's store yet — only on copies. It is also the ONLY rung that
 *  still knows the works' old ids, which is what the kept-file move needs:
 *  after it, those directory names mean nothing to anybody. */
export function foldWorks_1_53_0(store: Conf<PersistedState>): void {
  const works: unknown = store.get("works");
  if (!Array.isArray(works)) return;
  const folded = foldWorksByKey_1_53_0(
    works,
    recordOf(store.get("members")) ?? {},
  );
  moveKeptFiles_1_53_0(join(dirname(store.path), "works"), folded.moves);
  store.set("works", folded.works as unknown as PersistedState["works"]);
  store.set("members", folded.members as unknown as PersistedState["members"]);
  splitWorkAskRows_1_53_0(dirname(store.path));
}

/** A transcript row that asked a question ABOUT A PIECE OF WORK used to be an
 *  `ask` row with an optional `work` field — two kinds of thing under one
 *  tag, which every reader had to re-discriminate. They are their own kind
 *  now (`work-ask`), so the file is rewritten. */
export function splitWorkAskRows_1_53_0(stateRoot: string): void {
  const path = transcriptFilePath(stateRoot);
  if (!existsSync(path)) return;
  let held: unknown;
  try {
    held = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    // A transcript this build cannot parse is left exactly as it is: the
    // reader refuses it by name, which is a recovery a person can act on.
    return;
  }
  const record = recordOf(held);
  const rows = record === null ? null : record.rows;
  if (!Array.isArray(rows)) return;
  writeTranscriptFile(
    path,
    TRANSCRIPT_VERSION_1_53_0,
    rows.map((value: unknown) => {
      const row = recordOf(value);
      if (row === null || row.kind !== "ask") return value;
      return typeof row.work === "string" && row.work !== ""
        ? { ...row, kind: "work-ask" }
        : row;
    }),
  );
}

/** THE FOUR SETUP QUESTIONS KOLU NOW DRAWS THE OPTIONS FOR, as 1.54.0 froze
 *  them. Copied rather than imported from `kolu-work`: a rung keeps producing
 *  the bytes it was proven against, whatever that package's key list does
 *  next. */
const KOLU_CHOICE_KEYS_1_54_0: ReadonlySet<string> = new Set([
  "planner.harness",
  "planner.model",
  "implementor.harness",
  "implementor.model",
]);

/** The 1.54.0 rung — THE CONDUCTOR NO LONGER OFFERS OPTIONS FOR A ROLE'S
 *  HARNESS OR ITS MODEL, and an answer to one of those questions is now ONE
 *  VALUE. Two rewrites, same rung: it has not shipped.
 *
 *  A decision whose `key` is one of {@link KOLU_CHOICE_KEYS_1_54_0} has no
 *  `options` and no `multiple` any more: the harnesses are the agent-distro
 *  listing this kolu carries, and the models are what the work's HOST answers
 *  for the chosen harness, asked for when the form is drawn and never saved
 *  (a saved model list goes stale the day that host's agents update). So for
 *  every decision with one of those keys, ASKED OR ANSWERED, both fields are
 *  deleted. That is what keeps an OPEN form answerable: a question still
 *  carrying the Conductor's own options becomes one kolu draws the options
 *  for, which is the only shape the form can now be answered in.
 *
 *  AN ANSWERED one is also normalized, because the kolu-choice answer schema
 *  now admits at most one `picked` and `text: null`. The value kept is the
 *  one the 1.53.0 reading took — `answer.picked[0]` if there was one, else
 *  `answer.text` — written back as `picked: [value]`, `text: null`; a
 *  declined or dropped answer becomes `picked: [], text: null`. The value is
 *  kept VERBATIM, neither trimmed nor checked: a typed `"fable 5.2"` stays
 *  what it was, and kolu refuses it by name when the role starts and asks
 *  again. `at`, `how` and `from` are untouched, as is every other decision —
 *  a `mode` or `on-green` decision keeps its options and its typed text.
 *
 *  IDEMPOTENT: a decision already in that shape — no `options`, no
 *  `multiple`, at most one `picked`, `text` null — is returned as the same
 *  object, and a store with nothing to change is not written back at all. The
 *  works record is a keyed object at 1.53.0 (`{ [workId]: Work }`) and is read
 *  as untyped JSON, like every rung before it. The transcript file's row shape
 *  does not change, so `TRANSCRIPT_FILE_VERSION` stays at 1.53.0.
 *
 *  Exported for `stateMigration.test.ts`. */
export function dropKoluChoiceOptions_1_54_0(
  store: Conf<PersistedState>,
): void {
  const works = recordOf(store.get("works"));
  if (works === null) return;
  let changed = false;
  const next: Record<string, unknown> = {};
  for (const [id, value] of Object.entries(works)) {
    const work = recordOf(value);
    if (work === null || !Array.isArray(work.decisions)) {
      next[id] = value;
      continue;
    }
    let touched = false;
    const decisions = work.decisions.map((one: unknown) => {
      const decision = recordOf(one);
      if (decision === null) return one;
      if (typeof decision.key !== "string") return one;
      if (!KOLU_CHOICE_KEYS_1_54_0.has(decision.key)) return one;
      const answer =
        decision.kind === "answered" ? recordOf(decision.answer) : null;
      const normalized = answer === null ? null : normalizeChoiceAnswer(answer);
      const strip = "options" in decision || "multiple" in decision;
      if (!strip && normalized === null) return one;
      touched = true;
      const { options: _options, multiple: _multiple, ...rest } = decision;
      return normalized === null ? rest : { ...rest, answer: normalized };
    });
    if (!touched) {
      next[id] = value;
      continue;
    }
    changed = true;
    next[id] = { ...work, decisions };
  }
  if (!changed) return;
  store.set("works", next as unknown as PersistedState["works"]);
}

/** The one-value rewrite of a stored kolu-choice answer, or `null` when it
 *  already is one. Untyped JSON: anything that is not the shape this reads is
 *  left to the schema to refuse. */
function normalizeChoiceAnswer(
  answer: Record<string, unknown>,
): Record<string, unknown> | null {
  const picked = Array.isArray(answer.picked) ? answer.picked : [];
  const value =
    answer.how === "answered"
      ? picked.length > 0
        ? picked[0]
        : (answer.text ?? null)
      : null;
  const nextPicked = value === null ? [] : [value];
  if (
    answer.text === null &&
    picked.length === nextPicked.length &&
    picked[0] === nextPicked[0]
  ) {
    return null;
  }
  return { ...answer, picked: nextPicked, text: null };
}

/** THE WORDS KOLU ANSWERS ITS OWN SETUP QUESTIONS IN, as 1.55.0 froze them —
 *  the modes, what to do on green, and the four questions kolu draws the
 *  options for. Copied rather than imported from `kolu-work`, by this file's
 *  own rule: a rung keeps producing the bytes it was proven against, whatever
 *  that package's vocabulary does next. */
const WORK_MODES_1_55_0: ReadonlySet<string> = new Set([
  "full",
  "trivial",
  "watch",
]);
const ON_GREEN_1_55_0: ReadonlySet<string> = new Set(["merge", "hand-over"]);
const KOLU_CHOICE_KEYS_1_55_0: ReadonlySet<string> = new Set([
  "planner.harness",
  "planner.model",
  "implementor.harness",
  "implementor.model",
]);

/** The event kinds whose `why` is an AGENT'S OWN SHORT REASON — the ones that
 *  become the `none`/`reason` sum. `keep-failed` is deliberately NOT here: its
 *  `why` is kolu's own sentence about a copy that failed, and it is still a
 *  plain string. */
const AGENT_WHY_KINDS_1_55_0: ReadonlySet<string> = new Set([
  "ready",
  "stopped",
  "asking",
  "exited",
  "asleep",
]);

/** The check events, whose `head` becomes the `unreported`/`commit` sum. */
const CHECK_KINDS_1_55_0: ReadonlySet<string> = new Set([
  "checks-running",
  "checks-passed",
  "checks-failed",
]);

/** The strings in a stored list, and nothing else. */
const stringsOf_1_55_0 = (value: unknown): ReadonlyArray<string> =>
  Array.isArray(value)
    ? value.filter((one): one is string => typeof one === "string")
    : [];

/** HOW A 1.54.0 DECISION ENDED, read as the three things that can be true of
 *  it: nobody has answered it, somebody "answered" it with NO VALUE (the
 *  state this round deletes), or it is settled and here is the settlement in
 *  the new shape. */
type Settlement_1_55_0 =
  | { readonly how: "asked" }
  | { readonly how: "none"; readonly at: string }
  | { readonly how: "settled"; readonly answer: Record<string, unknown> };

/** THE VALUE a 1.54.0 answer carried, by what the question was about — or
 *  `null` for the answer that carried none.
 *
 *  A question about the WORK keeps both halves of what a person said (the
 *  options they ticked and the words they typed, trimmed) as the `said` sum;
 *  `mode` and `on-green` must be one of kolu's own words, so anything else
 *  stored under them is no value at all; one of kolu's four choices is one
 *  non-empty string, verbatim — a typed model id is kept as typed and judged
 *  when the role starts, exactly as 1.54.0 left it. */
const valueOf_1_55_0 = (
  key: string | null,
  answer: Record<string, unknown>,
): Record<string, unknown> | null => {
  const picked = stringsOf_1_55_0(answer.picked);
  const typed = typeof answer.text === "string" ? answer.text : "";
  if (key === null) {
    const text = typed.trim();
    if (picked.length > 0 && text !== "")
      return { said: { kind: "picked-and-typed", picked, text } };
    if (picked.length > 0) return { said: { kind: "picked", picked } };
    return text === "" ? null : { said: { kind: "typed", text } };
  }
  if (key === "mode" || key === "on-green") {
    const word = picked[0] ?? typed.trim();
    const words = key === "mode" ? WORK_MODES_1_55_0 : ON_GREEN_1_55_0;
    return words.has(word) ? { value: word } : null;
  }
  const value = picked[0] ?? typed;
  return value === "" ? null : { value };
};

/** ... and the whole settlement: a decline keeps the face it was said on (a
 *  decline with no face is nobody declining, which is what `dropped` means),
 *  a drop keeps only its moment, and an answer keeps its value and where it
 *  came from — `from: null` being the answers kolu CARRIED OVER from the file
 *  it kept before it stored work, which now say so by name. */
const settlementOf_1_55_0 = (
  decision: Record<string, unknown>,
  key: string | null,
): Settlement_1_55_0 => {
  if (decision.kind !== "answered") return { how: "asked" };
  const answer = recordOf(decision.answer);
  if (answer === null) return { how: "asked" };
  const at = text(answer.at);
  const from = typeof answer.from === "string" ? answer.from : null;
  if (answer.how === "declined")
    return from === null
      ? { how: "settled", answer: { how: "dropped", at } }
      : { how: "settled", answer: { how: "declined", at, from } };
  if (answer.how === "dropped")
    return { how: "settled", answer: { how: "dropped", at } };
  const value = valueOf_1_55_0(key, answer);
  if (value === null) return { how: "none", at };
  return {
    how: "settled",
    answer: { how: "answered", at, from: from ?? "carried-over", ...value },
  };
};

/** ONE 1.54.0 DECISION as the sum it is now, or the SAME OBJECT when it
 *  already is one (a decision with a `topic` has walked this rung).
 *
 *  `open` is whether the work it sits on is still being done, and it decides
 *  the one case this rung exists for: an "answered" decision with no value.
 *  In an OPEN work that question is ASKED AGAIN — same ask, same id, same
 *  words, no answer — because the human never answered it and the form is
 *  still theirs to fill in. In an ENDED one there is nobody left to ask, so
 *  it is settled as `dropped` at the moment the empty answer claimed. */
const decisionOf_1_55_0 = (value: unknown, open: boolean): unknown => {
  const decision = recordOf(value);
  if (decision === null || "topic" in decision) return value;
  const {
    kind: _kind,
    key: storedKey,
    header,
    file,
    options,
    multiple,
    answer: _answer,
    ...rest
  } = decision;
  const key = typeof storedKey === "string" ? storedKey : null;
  const fields =
    key === null
      ? {
          ...rest,
          topic: "work",
          header:
            text(header) === ""
              ? { kind: "none" }
              : { kind: "header", text: header },
          options: stringsOf_1_55_0(options),
          multiple: multiple === true,
          file:
            text(file) === "" ? { kind: "none" } : { kind: "file", path: file },
        }
      : KOLU_CHOICE_KEYS_1_55_0.has(key)
        ? { ...rest, topic: "setup", key }
        : {
            ...rest,
            topic: "setup",
            key,
            options: stringsOf_1_55_0(options).filter((one) =>
              (key === "mode" ? WORK_MODES_1_55_0 : ON_GREEN_1_55_0).has(one),
            ),
          };
  const settlement = settlementOf_1_55_0(decision, key);
  switch (settlement.how) {
    case "asked":
      return { kind: "asked", ...fields };
    case "none":
      return open
        ? { kind: "asked", ...fields }
        : {
            kind: "settled",
            ...fields,
            answer: { how: "dropped", at: settlement.at },
          };
    case "settled":
      return { kind: "settled", ...fields, answer: settlement.answer };
  }
};

/** ONE 1.54.0 EVENT as the arms it is now, or the SAME OBJECT when it already
 *  carries them (an event with an `about` has walked this rung).
 *
 *  `reasked` is the asks that came out of the decision rewrite with a question
 *  still open in them: an `answered` line about such an ask would say the
 *  human finished a form they never finished, so it becomes `answered-part` —
 *  the event kind this round adds for exactly that reading. */
const eventOf_1_55_0 = (
  value: unknown,
  reasked: ReadonlySet<string>,
): unknown => {
  const event = recordOf(value);
  if (event === null || "about" in event) return value;
  const { terminal, ...rest } = event;
  const ref = text(terminal);
  const base: Record<string, unknown> = {
    ...rest,
    about: ref === "" ? { kind: "work" } : { kind: "member", terminal: ref },
  };
  const kind = text(event.kind);
  if (kind === "requested") {
    const { text: words, ...without } = base;
    return {
      ...without,
      request:
        text(words) === "" ? { kind: "none" } : { kind: "said", text: words },
    };
  }
  if (AGENT_WHY_KINDS_1_55_0.has(kind)) {
    const why = text(base.why);
    return {
      ...base,
      why: why === "" ? { kind: "none" } : { kind: "reason", text: why },
    };
  }
  if (CHECK_KINDS_1_55_0.has(kind)) {
    const sha = text(base.head);
    return {
      ...base,
      head: sha === "" ? { kind: "unreported" } : { kind: "commit", sha },
    };
  }
  if (kind === "answered" && reasked.has(text(event.ask)))
    return { ...base, kind: "answered-part" };
  return base;
};

/** The 1.55.0 rung — NO HOLE IN THE WORK MODEL, in the bytes as well as in
 *  the types (juspay/kolu#2380).
 *
 *  A stored decision could say `{"kind":"answered","answer":{"how":"answered",
 *  "picked":[],"text":null,"from":"chat"}}` — answered, with no answer — and
 *  three readers each decided for themselves what that meant, so the work it
 *  was on could neither be started (the setup had "no model") nor asked again
 *  (the question was "answered"). The model now says a thing that may be
 *  absent is an ARM saying what the absence means, and this rung takes every
 *  stored work to that shape:
 *
 *  - A DECISION IS `asked` OR `settled`, about the `setup` (with its key) or
 *    about the `work` (with no key at all — the `key: null` it used to carry
 *    is deleted). A work question's `header` and `file` become their
 *    `none`/`header`/`file` arms rather than `""`; a setup question loses
 *    both, and its `multiple` with them, because its label is its key's own
 *    name and kolu's four choices take one value. `mode` and `on-green` keep
 *    only options that are kolu's own words.
 *  - AN ANSWER CARRIES ITS VALUE, by arm: what a person SAID about the work
 *    (picked, typed, or both), or the one word a setup question takes. An
 *    answer `from: null` is one kolu carried over from the file it kept
 *    before it stored work, and says so.
 *  - AN ANSWER WITH NO VALUE IS NOT AN ANSWER. In an OPEN work the question
 *    goes back to `asked` — the same ask, the same words, waiting on the same
 *    person, which is what the human's own store needs: their two model
 *    questions come back as the open questions they always were, and the card
 *    and the Conductor both read them that way. In an ENDED work it is
 *    settled `dropped`: there is nobody to ask any more.
 *  - AN EVENT SAYS WHAT IT IS ABOUT (`about`: the work, or one member
 *    terminal) instead of a nullable `terminal`; `requested` carries the
 *    human's words or none; an agent-state event carries a reason or none; a
 *    check event carries the commit it ran on or says the host reported none.
 *    An `answered` line about an ask this rung has just re-opened becomes
 *    `answered-part` — part of the form was answered and the rest is still
 *    asked, which is the true thing to say about it.
 *  - A MEMBER'S `worktree` is `unread` until something has read the terminal,
 *    and `read` with its path after.
 *
 *  IDEMPOTENT by construction: a decision already carrying a `topic`, an
 *  event already carrying an `about` and a member whose `worktree` is already
 *  an object are returned AS THE SAME OBJECT, and a store with nothing to
 *  change is not written back at all — neither key.
 *
 *  Untyped JSON in, as every rung reads its own era's records: the works key
 *  is the object keyed by work id that 1.53.0 made, the members key is the
 *  one map keyed by terminal ref, and anything this does not recognise walks
 *  past to the schema that refuses it by name.
 *
 *  THE TRANSCRIPT FILE MOVES IN THE SAME RUNG, for the same reason and by
 *  this file's own rule ({@link TRANSCRIPT_FILE_VERSION}): a `work-ask` row's
 *  `ask` used to carry `outcome: null | {how, answers}` beside a `link`, and
 *  "answered with no answers" was sayable there too. It carries a STANDING
 *  now ({@link workAskStanding_1_55_0}), so the rows are rewritten and the
 *  file is stamped 1.55.0.
 *
 *  Exported for `stateMigration.test.ts`, which drives it over the human's
 *  own bytes. */
export function workArmsNotNulls_1_55_0(store: Conf<PersistedState>): void {
  const works = recordOf(store.get("works"));
  if (works !== null) {
    let changed = false;
    const next: Record<string, unknown> = {};
    for (const [id, value] of Object.entries(works)) {
      const work = recordOf(value);
      if (work === null) {
        next[id] = value;
        continue;
      }
      const open = recordOf(work.state)?.kind !== "ended";
      const decisions = Array.isArray(work.decisions) ? work.decisions : [];
      const nextDecisions = decisions.map((one: unknown) =>
        decisionOf_1_55_0(one, open),
      );
      // The asks that still hold an open question AFTER the rewrite — what
      // turns an `answered` line into an `answered-part` one. Only on an OPEN
      // work: an ended one is nobody's to answer, and the lines on it are the
      // history of what happened while it ran.
      const reasked = new Set<string>();
      if (open)
        for (const one of nextDecisions) {
          const decision = recordOf(one);
          if (decision?.kind === "asked") reasked.add(text(decision.ask));
        }
      const events = Array.isArray(work.events) ? work.events : [];
      const nextEvents = events.map((one: unknown) =>
        eventOf_1_55_0(one, reasked),
      );
      const touched =
        nextDecisions.some((one, at) => one !== decisions[at]) ||
        nextEvents.some((one, at) => one !== events[at]);
      if (!touched) {
        next[id] = value;
        continue;
      }
      changed = true;
      next[id] = { ...work, decisions: nextDecisions, events: nextEvents };
    }
    if (changed) store.set("works", next as unknown as PersistedState["works"]);
  }
  workAskStanding_1_55_0(dirname(store.path));
  const members = recordOf(store.get("members"));
  if (members === null) return;
  let moved = false;
  const nextMembers: Record<string, unknown> = {};
  for (const [ref, value] of Object.entries(members)) {
    const member = recordOf(value);
    if (member === null || recordOf(member.worktree) !== null) {
      nextMembers[ref] = value;
      continue;
    }
    moved = true;
    const path = text(member.worktree);
    nextMembers[ref] = {
      ...member,
      worktree: path === "" ? { kind: "unread" } : { kind: "read", path },
    };
  }
  if (moved)
    store.set("members", nextMembers as unknown as PersistedState["members"]);
}

/** THE VERSION 1.55.0 STAMPS INTO THE TRANSCRIPT FILE it rewrites — frozen
 *  under this rung's own number for the reason {@link TRANSCRIPT_VERSION_1_53_0}
 *  gives: the live constant moves to the NEXT rung that changes a row, and a
 *  stamp is refused by name rather than guessed at. */
const TRANSCRIPT_VERSION_1_55_0 = "1.55.0";

/** A `work-ask` ROW'S ASK CARRIES A STANDING, not an outcome that could be
 *  `answered` with nothing in it.
 *
 *  The row drew kolu's own question about a piece of work, and said how it
 *  ended with `outcome: null | {how, answers}` — the same hole the decisions
 *  had, in the conversation's copy of them: a form answered with every box
 *  left empty read as answered and drew as answered, while the work's own
 *  question was still waiting on somebody. The standing is a sum
 *  (`open | part | answered | declined | withdrawn`), so this rewrites each
 *  stored row into it:
 *
 *  - `null` → `{kind:"open"}`: nobody has answered yet.
 *  - `declined` / `withdrawn` → their own arms, which carry nothing.
 *  - `answered` → `{kind:"answered", answers}` with the answers that actually
 *    HAVE values; an "answered" whose answers are all empty is nobody
 *    answering, and becomes `{kind:"declined"}` — the honest reading of a
 *    form that settled with nothing in it, and the one that stops the row
 *    drawing as a question the person already dealt with.
 *  - `ask.link` is gone and is dropped.
 *
 *  A USER ROW'S `auth: true` — "refused, and nobody is signed in" — becomes
 *  `signIn: "signed-out"`, the one arm of the reason a refusal signing in
 *  could fix that this build's rows had a spelling for.
 *
 *  PLAIN `ask` ROWS (the agent holding a call open on a person) are NOT
 *  touched: they keep the outcome shape they always had. A row that already
 *  carries its new shape has walked this rung.
 *
 *  THE STAMP MOVES WHETHER OR NOT A ROW DID. The reader takes exactly the
 *  version it was built with, so a file left at 1.53.0 because nothing in it
 *  needed rewriting — a transcript after a New session, say — would be
 *  refused by name on the very boot this rung ran.
 *
 *  Exported for `stateMigration.test.ts`. */
export function workAskStanding_1_55_0(stateRoot: string): void {
  const path = transcriptFilePath(stateRoot);
  if (!existsSync(path)) return;
  let held: unknown;
  try {
    held = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    // A transcript this build cannot parse is left exactly as it is: the
    // reader refuses it by name, which is a recovery a person can act on.
    return;
  }
  const record = recordOf(held);
  const rows = record === null ? null : record.rows;
  if (!Array.isArray(rows)) return;
  let changed = record?.version !== TRANSCRIPT_VERSION_1_55_0;
  const next = rows.map((value: unknown) => {
    const row = recordOf(value);
    if (row !== null && row.kind === "user" && "auth" in row) {
      changed = true;
      const { auth, ...rest } = row;
      return auth === true ? { ...rest, signIn: "signed-out" } : rest;
    }
    if (row === null || row.kind !== "work-ask") return value;
    const ask = recordOf(row.ask);
    if (ask === null || "standing" in ask) return value;
    changed = true;
    const { link: _link, outcome, ...rest } = ask;
    const settled = recordOf(outcome);
    if (settled === null)
      return { ...row, ask: { ...rest, standing: { kind: "open" } } };
    const answers = (Array.isArray(settled.answers) ? settled.answers : [])
      .map(recordOf)
      .filter(
        (one): one is Record<string, unknown> =>
          one !== null && stringsOf_1_55_0(one.values).length > 0,
      );
    const standing =
      settled.how === "answered" && answers.length > 0
        ? { kind: "answered", answers }
        : { kind: settled.how === "withdrawn" ? "withdrawn" : "declined" };
    return { ...row, ask: { ...rest, standing } };
  });
  if (!changed) return;
  writeTranscriptFile(path, TRANSCRIPT_VERSION_1_55_0, next);
}

/** The four questions kolu draws the options for, as 1.56.0 froze them —
 *  copied rather than imported, by this file's own rule. */
const KOLU_CHOICE_KEYS_1_56_0: ReadonlySet<string> = new Set([
  "planner.harness",
  "planner.model",
  "implementor.harness",
  "implementor.model",
]);

/** ONE DECISION as 1.56.0 stores it: an answer to one of kolu's own questions
 *  gains `chosen`, and every other decision is the SAME OBJECT. A decision
 *  that already says how it was chosen has walked this rung. */
const decisionOf_1_56_0 = (value: unknown): unknown => {
  const decision = recordOf(value);
  if (
    decision === null ||
    decision.kind !== "settled" ||
    typeof decision.key !== "string" ||
    !KOLU_CHOICE_KEYS_1_56_0.has(decision.key)
  )
    return value;
  const answer = recordOf(decision.answer);
  if (answer === null || answer.how !== "answered" || "chosen" in answer)
    return value;
  return { ...decision, answer: { ...answer, chosen: "picked" } };
};

/** The 1.56.0 rung — AN ANSWER TO ONE OF KOLU'S QUESTIONS SAYS HOW IT WAS
 *  CHOSEN: picked from what kolu drew, or typed by the person. A typed model
 *  goes to the harness as typed and is never held to the host's list; a
 *  picked one is, whenever the host can list.
 *
 *  Every answer stored before this rung becomes `picked`, and that is what
 *  each was judged as. A harness answer was always one kolu carries. A model
 *  answer was held to the host's list whenever its harness had one (the rule
 *  refused anything else where it was recorded and again at start), and for
 *  a harness with no list the one-word rule was all that was asked — which
 *  is exactly how a picked model under such a harness is judged now. So no
 *  saved answer starts or stops passing because of this rung.
 *
 *  Only `works` moves; the transcript file's rows keep their own shape, so
 *  TRANSCRIPT_FILE_VERSION stays at 1.55.0. Exported for
 *  `stateMigration.test.ts`. */
export function koluChoicesSayHowChosen_1_56_0(
  store: Conf<PersistedState>,
): void {
  const works = recordOf(store.get("works"));
  if (works === null) return;
  let changed = false;
  const next: Record<string, unknown> = {};
  for (const [id, value] of Object.entries(works)) {
    const work = recordOf(value);
    const decisions = Array.isArray(work?.decisions) ? work.decisions : null;
    if (work === null || decisions === null) {
      next[id] = value;
      continue;
    }
    const nextDecisions = decisions.map(decisionOf_1_56_0);
    if (nextDecisions.every((one, at) => one === decisions[at])) {
      next[id] = value;
      continue;
    }
    changed = true;
    next[id] = { ...work, decisions: nextDecisions };
  }
  if (changed) store.set("works", next as unknown as PersistedState["works"]);
}

/** Two saved heads name the same commit — by `kind` and `sha`, never by how
 *  the object happens to be spelled. */
const sameHead_1_57_0 = (a: unknown, b: unknown): boolean => {
  const one = recordOf(a);
  const two = recordOf(b);
  if (one === null || two === null || one.kind !== two.kind) return false;
  return one.kind !== "commit" || one.sha === two.sha;
};

/** ONE TIMELINE as 1.57.0 stores it — the SAME ARRAY when nothing moves.
 *
 *  - A `pr-opened` gains `url`: `unrecorded`, because kolu did not keep the
 *    address before this rung and inventing one (a guess from the
 *    repository's remote) would be a link that may lead nowhere. A work still
 *    in progress learns the real one from its next PR reading.
 *  - On a FINISHED work, every `checks-passed` is followed by a
 *    `merge-state` saying the PR could merge, at the same instant, for the
 *    same PR and commit. Before this rung a passing check WAS green — that is
 *    what the hand-over read — and the fold now reads green off the forge's
 *    merge answer, so this gives each finished timeline the reading it had:
 *    its Merge time stays Merge rather than turning into Review. A work in
 *    progress gets none: its next PR reading records GitHub's real answer,
 *    and until then it is not green, rather than green off a pass that may
 *    have been too early. A `checks-passed` already followed by a merge
 *    answer for its commit has walked this rung, and one for a PR that was
 *    later closed without merging gets none: nobody merged it, and the
 *    timeline must not say the forge would have. */
const eventsOf_1_57_0 = (
  events: ReadonlyArray<unknown>,
  finished: boolean,
): ReadonlyArray<unknown> => {
  const closed = new Set(
    events.flatMap((value) => {
      const event = recordOf(value);
      return event?.kind === "pr-closed" ? [event.pr] : [];
    }),
  );
  let changed = false;
  const next: unknown[] = [];
  events.forEach((value, at) => {
    const event = recordOf(value);
    if (event?.kind === "pr-opened" && !("url" in event)) {
      changed = true;
      next.push({ ...event, url: { kind: "unrecorded" } });
      return;
    }
    next.push(value);
    if (!finished || event?.kind !== "checks-passed") return;
    if (closed.has(event.pr)) return;
    const following = recordOf(events[at + 1]);
    if (
      following?.kind === "merge-state" &&
      following.pr === event.pr &&
      sameHead_1_57_0(following.head, event.head)
    )
      return;
    changed = true;
    next.push({
      at: event.at,
      by: "kolu",
      about: { kind: "work" },
      kind: "merge-state",
      pr: event.pr,
      head: event.head,
      merge: { kind: "can" },
    });
  });
  return changed ? next : events;
};

/** The 1.57.0 rung — A PULL REQUEST'S ADDRESS AND THE FORGE'S MERGE ANSWER
 *  ARE ON THE TIMELINE. `pr-opened` carries the PR's `url`, so a finished
 *  work's PR is still a link, and a new event kind, `merge-state`, records
 *  whether the forge would merge the PR — the fact "green" is read off now,
 *  kept apart from what the checks that have reported say.
 *  {@link eventsOf_1_57_0} says what each saved timeline gets. Only `works`
 *  moves; the transcript file's rows keep their shape, so
 *  TRANSCRIPT_FILE_VERSION stays at 1.55.0. Exported for
 *  `stateMigration.test.ts`. */
export function prFactsOnTheTimeline_1_57_0(store: Conf<PersistedState>): void {
  const works = recordOf(store.get("works"));
  if (works === null) return;
  let changed = false;
  const next: Record<string, unknown> = {};
  for (const [id, value] of Object.entries(works)) {
    const work = recordOf(value);
    const events = Array.isArray(work?.events) ? work.events : null;
    if (work === null || events === null) {
      next[id] = value;
      continue;
    }
    const nextEvents = eventsOf_1_57_0(
      events,
      recordOf(work.state)?.kind === "ended",
    );
    if (nextEvents === events) {
      next[id] = value;
      continue;
    }
    changed = true;
    next[id] = { ...work, events: nextEvents };
  }
  if (changed) store.set("works", next as unknown as PersistedState["works"]);
}

/** THE VERSION 1.58.0 STAMPS INTO THE TRANSCRIPT FILE it rewrites — frozen
 *  under this rung's own number, for the reason
 *  {@link TRANSCRIPT_VERSION_1_53_0} gives. */
const TRANSCRIPT_VERSION_1_58_0 = "1.58.0";
/** ... and what {@link toolOutings_1_59_0} stamped. */
const TRANSCRIPT_VERSION_1_59_0 = "1.59.0";
const TRANSCRIPT_VERSION_1_62_0 = "1.62.0";

/** The 1.58.0 rung — A MENTION SAYS WHAT IT IS. A user row's `mentions`
 *  could only name terminals; it now names a terminal or a piece of work,
 *  told apart by `kind`. Every saved mention was a terminal, so each one
 *  gains `kind: "terminal"` and nothing else moves. A mention that already
 *  carries a `kind` has walked this rung.
 *
 *  The stamp moves whether or not a row did, for the reason
 *  {@link workAskStanding_1_55_0} gives: the reader takes exactly the
 *  version it was built with. `works` and the rest of `config.json` are
 *  untouched. Exported for `stateMigration.test.ts`. */
/** A TOOL ROW MAY SAY WHEN THIS OUTING BEGAN (`resumed`). An old row omits it,
 *  and a reader takes that as "first outing" — so nothing is rewritten; only the
 *  file's stamp moves, which is what the row-shape rule asks for. */
export function toolOutings_1_59_0(stateRoot: string): void {
  const path = transcriptFilePath(stateRoot);
  if (!existsSync(path)) return;
  let held: unknown;
  try {
    held = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    // Left exactly as it is: the reader refuses it by name.
    return;
  }
  const record = recordOf(held);
  if (record === null || !Array.isArray(record.rows)) return;
  if (record.version === TRANSCRIPT_VERSION_1_59_0) return;
  writeTranscriptFile(path, TRANSCRIPT_VERSION_1_59_0, record.rows);
}

export function compactionRows_1_62_0(stateRoot: string): void {
  const path = transcriptFilePath(stateRoot);
  if (!existsSync(path)) return;
  let held: unknown;
  try {
    held = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return;
  }
  const record = recordOf(held);
  if (record === null || !Array.isArray(record.rows)) return;
  if (record.version === TRANSCRIPT_VERSION_1_62_0) return;
  writeTranscriptFile(path, TRANSCRIPT_VERSION_1_62_0, record.rows);
}

const TRANSCRIPT_VERSION_1_63_0 = "1.63.0";

/** The 1.63.0 rung — THE CONDUCTOR'S MEMORY. `config.json` gains a `memory`
 *  key, seeded empty (a value frozen here, not the live empty one); a store
 *  that already holds one keeps it. The transcript file is re-stamped by
 *  {@link memoryProposalRows_1_63_0}. */
export function memory_1_63_0(store: Conf<PersistedState>): void {
  if (!store.has("memory"))
    store.set("memory", {
      entries: [],
      proposals: [],
      declined: [],
      next: 1,
    });
  memoryProposalRows_1_63_0(dirname(store.path));
}

/** A row may now be a `memory-proposal`. No older row is one, so no row is
 *  rewritten: only the file's stamp moves. */
export function memoryProposalRows_1_63_0(stateRoot: string): void {
  const path = transcriptFilePath(stateRoot);
  if (!existsSync(path)) return;
  let held: unknown;
  try {
    held = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return;
  }
  const record = recordOf(held);
  if (record === null || !Array.isArray(record.rows)) return;
  if (record.version === TRANSCRIPT_VERSION_1_63_0) return;
  writeTranscriptFile(path, TRANSCRIPT_VERSION_1_63_0, record.rows);
}

export function mentionsSayTheirKind_1_58_0(stateRoot: string): void {
  const path = transcriptFilePath(stateRoot);
  if (!existsSync(path)) return;
  let held: unknown;
  try {
    held = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    // Left exactly as it is: the reader refuses it by name.
    return;
  }
  const record = recordOf(held);
  const rows = record === null ? null : record.rows;
  if (!Array.isArray(rows)) return;
  let changed = record?.version !== TRANSCRIPT_VERSION_1_58_0;
  const next = rows.map((value: unknown) => {
    const row = recordOf(value);
    if (row === null || row.kind !== "user" || !Array.isArray(row.mentions))
      return value;
    const mentions = row.mentions.map((one: unknown) => {
      const mention = recordOf(one);
      if (mention === null || "kind" in mention) return one;
      changed = true;
      return { kind: "terminal", ...mention };
    });
    return { ...row, mentions };
  });
  if (!changed) return;
  writeTranscriptFile(path, TRANSCRIPT_VERSION_1_58_0, next);
}

/** What every saved `pr-opened` is given by {@link prOpenedSaysDraft_1_61_0}
 *  — frozen under this rung's own number, so a later change to the live
 *  vocabulary never changes what this rung writes. */
const DRAFT_UNRECORDED_1_61_0 = "unrecorded";

/** The 1.61.0 rung — A PULL REQUEST SAYS WHETHER IT OPENED AS A DRAFT.
 *  `pr-opened` gains a required `draft`, and a new event kind, `draft-state`,
 *  records the PR being marked ready or turned back. Every saved `pr-opened`
 *  without the word gains `unrecorded`: kolu kept no record, a rung must not
 *  ask GitHub, and the fold must not guess. `unrecorded` reads as before —
 *  the build ended at the open, and the card says neither draft nor ready —
 *  so an old work keeps its reading, and a work in progress learns the real
 *  word from its next PR reading. No `draft-state` is invented and no
 *  `merge-state` is touched. The SAME array when nothing moves, and `works`
 *  is written only when something did. Only `works` moves; the transcript
 *  file is untouched, so TRANSCRIPT_FILE_VERSION stays at 1.59.0. Exported
 *  for `stateMigration.test.ts`. */
export function prOpenedSaysDraft_1_61_0(store: Conf<PersistedState>): void {
  const works = recordOf(store.get("works"));
  if (works === null) return;
  let changed = false;
  const next: Record<string, unknown> = {};
  for (const [id, value] of Object.entries(works)) {
    const work = recordOf(value);
    const events = Array.isArray(work?.events) ? work.events : null;
    if (work === null || events === null) {
      next[id] = value;
      continue;
    }
    let moved = false;
    const nextEvents = events.map((one: unknown) => {
      const event = recordOf(one);
      if (event?.kind !== "pr-opened" || "draft" in event) return one;
      moved = true;
      return { ...event, draft: DRAFT_UNRECORDED_1_61_0 };
    });
    if (!moved) {
      next[id] = value;
      continue;
    }
    changed = true;
    next[id] = { ...work, events: nextEvents };
  }
  if (changed) store.set("works", next as unknown as PersistedState["works"]);
}

/** The 1.64.0 rung — A WORK KEEPS ITS WORKTREE. A work gains a required
 *  `worktree` (`unread`, or `read` with the encoded `host` and the `path`),
 *  kept on the work so it outlives the terminals that told it. Every saved
 *  work without one is given it from what the store already holds, and from
 *  nothing else:
 *
 *  - an OPEN work with a member, in the `members` record's own order, whose
 *    saved `worktree` is `read`: `read`, with the FIRST such member's path as
 *    it was saved, and the host of that member's ref (everything before the
 *    ref's LAST `/` — a remote host key carries a `/` of its own; a terminal
 *    id never does);
 *  - an open work with no such member: `unread`;
 *  - an ENDED work: `unread` — its members went with its ending, and its
 *    files are the copies kolu kept, read without a worktree.
 *
 *  A path is copied as the store has it: a member first read in a subfolder
 *  keeps that subfolder here, because a rung has only the file and cannot
 *  ask git for the worktree's top. Such a work corrects itself when that
 *  terminal leaves and another joins. A value it does not know is walked
 *  past unchanged. The SAME object when nothing moves, and `works` is written
 *  only when something did. Only `works` moves; the transcript file is
 *  untouched, so TRANSCRIPT_FILE_VERSION stays at 1.63.0. Exported for
 *  `stateMigration.test.ts`. */
export function workKeepsItsWorktree_1_64_0(store: Conf<PersistedState>): void {
  const works = recordOf(store.get("works"));
  if (works === null) return;
  const members = recordOf(store.get("members")) ?? {};
  /** The first member of `id` whose saved worktree is read, as host and
   *  path. */
  const firstRead = (id: string): { host: string; path: string } | null => {
    for (const [ref, value] of Object.entries(members)) {
      const member = recordOf(value);
      if (member?.work !== id) continue;
      const worktree = recordOf(member.worktree);
      const cut = ref.lastIndexOf("/");
      if (
        worktree?.kind === "read" &&
        typeof worktree.path === "string" &&
        worktree.path !== "" &&
        cut > 0
      )
        return { host: ref.slice(0, cut), path: worktree.path };
    }
    return null;
  };
  let changed = false;
  const next: Record<string, unknown> = {};
  for (const [id, value] of Object.entries(works)) {
    const work = recordOf(value);
    if (work === null || "worktree" in work) {
      next[id] = value;
      continue;
    }
    const open = recordOf(work.state)?.kind === "open";
    const read = open ? firstRead(id) : null;
    changed = true;
    next[id] = {
      ...work,
      worktree:
        read === null
          ? { kind: "unread" }
          : { kind: "read", host: read.host, path: read.path },
    };
  }
  if (changed) store.set("works", next as unknown as PersistedState["works"]);
}

/** The 1.65.0 rung — WHERE EACH WORK'S CODE VIEW STANDS. `config.json` gains
 *  a `workCodeViews` key, seeded empty (a value frozen here, not the live
 *  empty one); a store that already holds one keeps it, whatever it holds —
 *  this rung does not read values it does not know. No other key moves, and
 *  the transcript file is untouched, so TRANSCRIPT_FILE_VERSION stays at
 *  1.63.0. Exported for `stateMigration.test.ts`. */
export function workCodeViews_1_65_0(store: Conf<PersistedState>): void {
  if (!store.has("workCodeViews")) store.set("workCodeViews", {});
}

/** What {@link handOffsKept_1_67_0} appends to every saved work, less its
 *  `at` — frozen under this rung's own number, so a later change to the live
 *  vocabulary never changes what this rung writes. */
const HAND_OFFS_KEPT_1_67_0 = {
  by: "kolu",
  about: { kind: "work" },
  kind: "hand-offs-kept",
} as const;

/** The 1.67.0 rung — WHO HOLDS A WORK IS RECORDED FROM HERE ON. A work's
 *  stage is now who holds it, read off the `told` events the Conductor's
 *  hand-offs write; a saved work has none, because kolu kept none, and a
 *  rung must not guess them. So every saved work, in progress or finished,
 *  gains ONE `hand-offs-kept` event, appended after its last: at its end
 *  time for a finished work (`state.at`), at its last event's time for one in
 *  progress (its start, for one with no events) — never a clock. The replay
 *  then files the time that would read Build or Review as `unrecorded` up to
 *  the first hand-off after it, and reads Plan, Approve, Checks and Merge as
 *  they were. A work that already carries the event is walked past, so the
 *  rung run twice changes nothing; a value it does not know is walked past
 *  unchanged. `works` is written only when something moved. Only `works`
 *  moves; the transcript file is untouched, so TRANSCRIPT_FILE_VERSION stays
 *  at 1.63.0. Exported for `stateMigration.test.ts`. */
export function handOffsKept_1_67_0(store: Conf<PersistedState>): void {
  const works = recordOf(store.get("works"));
  if (works === null) return;
  let changed = false;
  const next: Record<string, unknown> = {};
  for (const [id, value] of Object.entries(works)) {
    const work = recordOf(value);
    const events = Array.isArray(work?.events) ? work.events : null;
    const state = recordOf(work?.state);
    const last = recordOf(events?.at(-1));
    const at =
      state?.kind === "ended"
        ? state.at
        : last !== null
          ? last.at
          : work?.startedAt;
    if (
      work === null ||
      events === null ||
      typeof at !== "string" ||
      events.some((one: unknown) => recordOf(one)?.kind === "hand-offs-kept")
    ) {
      next[id] = value;
      continue;
    }
    changed = true;
    next[id] = {
      ...work,
      events: [...events, { at, ...HAND_OFFS_KEPT_1_67_0 }],
    };
  }
  if (changed) store.set("works", next as unknown as PersistedState["works"]);
}

/** A watch's stored `terminal`, split at its LAST `/` into the host and the
 *  id the 1.68.0 key holds — the fleet ref grammar's rule, frozen here: a host
 *  key may contain a `/`, a terminal id never does. `null` for a string that
 *  names no terminal (no `/`, or nothing on one side of it). */
const splitWatch_1_68_0 = (
  terminal: string,
): { readonly host: string; readonly id: string } | null => {
  const cut = terminal.lastIndexOf("/");
  return cut <= 0 || cut === terminal.length - 1
    ? null
    : { host: terminal.slice(0, cut), id: terminal.slice(cut + 1) };
};

/** THE MOVE TIME — one millisecond after the latest of the times given, as
 *  ISO-8601 strings compare. Strictly after, so the `joined` it stamps is
 *  the newest about the terminal even where the latest time is the
 *  terminal's own `joined` on the watch it leaves: a tie would leave which
 *  watch a reader names to the order of a map. */
const movedAt_1_68_0 = (times: ReadonlyArray<string>): string => {
  const latest = times.reduce((late, one) => (one > late ? one : late));
  const ms = Date.parse(latest);
  if (Number.isNaN(ms))
    throw new Error(`1.68.0: ${latest} is no time to move a terminal at`);
  return new Date(ms + 1).toISOString();
};

/** A timeline's last time, or `undefined` for an empty one; `null` when the
 *  timeline cannot be read — not a list, or a last event with no time. */
const lastAt_1_68_0 = (events: unknown): string | undefined | null => {
  if (!Array.isArray(events)) return null;
  if (events.length === 0) return undefined;
  const at = recordOf(events.at(-1))?.at;
  return typeof at === "string" ? at : null;
};

/** STEPS 4 AND 5's ONE MOVE — terminal `ref`, a member of watch `from` that
 *  cannot keep it (another terminal's watch, or a nameless one step 4
 *  removes), given a watch of its own in `works`. Answers the id it is now a
 *  member of.
 *
 *  ONE MOVE TIME, from the file and never a clock: a millisecond after the
 *  latest of the terminal's own join, the last time on the watch it leaves
 *  and the last time on the watch it joins ({@link movedAt_1_68_0}). A
 *  watch that stays says `left` (`released`, the live store's word for a
 *  terminal leaving one work for another) at that time; the watch it joins
 *  says `joined` at that time — reopened first, at that time, when it had
 *  finished — so the newest `joined` about the terminal is always on the
 *  watch its member row names, and every timeline stays in time order. A
 *  NEW watch is titled by the terminal's name (the old watch's title when
 *  it has none), starts and opens `carried-over` at the terminal's own join
 *  — the age a person was shown — and is joined at the move time.
 *
 *  A value it must read and cannot fails the rung loudly, before anything
 *  is written. Frozen history: the id spelling is 1.68.0's `workIdOf` for a
 *  watch, written out. */
const moveToOwnWatch_1_68_0 = (
  ref: string,
  member: Record<string, unknown>,
  from: {
    readonly id: string;
    readonly work: Record<string, unknown> | null;
    readonly stays: boolean;
  },
  works: Record<string, unknown>,
): string => {
  const split = splitWatch_1_68_0(ref);
  if (split === null)
    throw new Error(
      `1.68.0: watch ${from.id} holds ${ref}, which names no terminal to give a watch of its own`,
    );
  const joinedAt = member.joinedAt;
  if (typeof joinedAt !== "string")
    throw new Error(
      `1.68.0: ${ref} in watch ${from.id} has no join time to move it by`,
    );
  const id = `watch:${encodeURIComponent(ref)}`;
  const leaving = lastAt_1_68_0(from.work?.events);
  if (from.stays && (from.work === null || leaving === null))
    throw new Error(
      `1.68.0: watch ${from.id} has no timeline to say ${ref} left on`,
    );
  const target = recordOf(works[id]);
  const joining = target === null ? undefined : lastAt_1_68_0(target.events);
  if (joining === null)
    throw new Error(
      `1.68.0: the watch ${id} that ${ref} joins has no timeline to say so on`,
    );
  const at = movedAt_1_68_0(
    [joinedAt, leaving, joining].filter(
      (one): one is string => typeof one === "string",
    ),
  );
  const joined = {
    at,
    by: "kolu",
    about: { kind: "member", terminal: ref },
    kind: "joined",
    role: "other",
  };
  let next: Record<string, unknown>;
  if (target !== null) {
    // A WATCH OF THIS TERMINAL IS ALREADY KEPT: it is the one it joins.
    const events = target.events as ReadonlyArray<unknown>;
    const open = recordOf(target.state)?.kind === "open";
    next = {
      ...target,
      state: { kind: "open" },
      events: [
        ...events,
        ...(open
          ? []
          : [{ at, by: "kolu", about: { kind: "work" }, kind: "reopened" }]),
        joined,
      ],
    };
  } else {
    const name = recordOf(member.watch)?.name;
    const title =
      typeof name === "string" && name !== "" ? name : from.work?.title;
    if (typeof title !== "string")
      throw new Error(
        `1.68.0: ${ref} in watch ${from.id} has no title to give its own watch`,
      );
    next = {
      key: { kind: "watch", host: split.host, id: split.id },
      title,
      startedAt: joinedAt,
      decisions: [],
      events: [
        {
          at: joinedAt,
          by: "kolu",
          about: { kind: "work" },
          kind: "carried-over",
        },
        joined,
      ],
      state: { kind: "open" },
      worktree: { kind: "unread" },
    };
  }
  if (from.stays && from.work !== null)
    works[from.id] = {
      ...from.work,
      events: [
        ...(from.work.events as ReadonlyArray<unknown>),
        {
          at,
          by: "kolu",
          kind: "left",
          about: { kind: "member", terminal: ref },
          why: "released",
        },
      ],
    };
  works[id] = next;
  return id;
};

/** The 1.68.0 rung — A WORK'S FACTS ARE THE WORK'S. What a work stood on was
 *  read off whichever member terminal was there first, and its identity was
 *  strings a caller typed; it is now asked of git, on the work's host, by a
 *  key that was parsed. A rung asks no host, so it does only what the file
 *  alone allows:
 *
 *  1. every work's `worktree` becomes `unread` — the `read` a member lent it
 *     carried a host of the member's choosing, and the new shape (`unread`,
 *     `absent`, `at`) has no host at all. The watch re-reads it from git
 *     seconds after boot;
 *  2. every member's `worktree` is removed — a member no longer says where
 *     the work is;
 *  3. every watch's `key.terminal` is split at its LAST `/` into `host` and
 *     `id` ({@link splitWatch_1_68_0}). The map key does not change: the id
 *     a watch is filed under encodes the same ref, so its kept files
 *     (`workDirOf(id)`) still match;
 *  4. a watch whose `terminal` cannot be split never named a terminal: it is
 *     removed, with its Code view — and NO TERMINAL IN IT IS DROPPED: each
 *     member becomes a watch of its own, by step 5's move;
 *  5. every watch keeps its own terminal alone, as `other`, and NO WATCHED
 *     TERMINAL IS DROPPED: each other member becomes a watch of its own —
 *     keyed by itself, filed under the id a watch of that terminal has
 *     (`watch:<encoded ref>`), its member row and bookkeeping kept whole —
 *     the old watch saying it `left` (`released`) and the new one that it
 *     `joined`, at one move time ({@link moveToOwnWatch_1_68_0}). A watch of
 *     that terminal already filed is the one it joins — reopened when it had
 *     finished. A watch IS that one terminal, and the store now refuses
 *     anything else in one;
 *  6. every branch key gains `repoBy: { kind: "as-written" }` — its `repo` is
 *     what a caller typed, and the host's first answer re-keys it to git's
 *     root.
 *
 *  A value it does not know is walked past unchanged, and each key is
 *  written only when something in it moved. `works`, `members` and
 *  `workCodeViews` move; the transcript file is untouched, so
 *  TRANSCRIPT_FILE_VERSION stays at 1.63.0. Exported for
 *  `stateMigration.test.ts`. */
export function workFactsAreTheWorks_1_68_0(store: Conf<PersistedState>): void {
  /** The works step 4 removed — their members and views go with them. */
  const gone = new Set<string>();
  /** Each watch's own terminal, by the id the watch is filed under. */
  const watched = new Map<string, string>();
  const works = recordOf(store.get("works"));
  let worksChanged = false;
  const nextWorks: Record<string, unknown> = {};
  if (works !== null) {
    for (const [id, value] of Object.entries(works)) {
      const work = recordOf(value);
      const key = recordOf(work?.key);
      if (work === null || key === null) {
        nextWorks[id] = value;
        continue;
      }
      let nextKey: unknown = work.key;
      if (key.kind === "watch" && typeof key.terminal === "string") {
        const split = splitWatch_1_68_0(key.terminal);
        if (split === null) {
          gone.add(id);
          worksChanged = true;
          continue;
        }
        nextKey = { kind: "watch", host: split.host, id: split.id };
      } else if (key.kind === "branch" && !("repoBy" in key)) {
        nextKey = { ...key, repoBy: { kind: "as-written" } };
      }
      const keyNow = recordOf(nextKey);
      if (
        keyNow?.kind === "watch" &&
        typeof keyNow.host === "string" &&
        typeof keyNow.id === "string"
      )
        watched.set(id, `${keyNow.host}/${keyNow.id}`);
      if (nextKey === work.key && recordOf(work.worktree)?.kind === "unread") {
        nextWorks[id] = value;
        continue;
      }
      worksChanged = true;
      nextWorks[id] = { ...work, key: nextKey, worktree: { kind: "unread" } };
    }
  }
  /** The original works, for the title and timeline of a watch step 4
   *  removed. */
  const before = works ?? {};
  /** The members as this rung leaves them — written after every check. */
  let nextMembers: Record<string, unknown> | null = null;
  const members = recordOf(store.get("members"));
  if (members !== null) {
    let changed = false;
    const next: Record<string, unknown> = {};
    for (const [ref, value] of Object.entries(members)) {
      const member = recordOf(value);
      const work = typeof member?.work === "string" ? member.work : null;
      if (member !== null && work !== null && gone.has(work)) {
        // A NAMELESS WATCH'S TERMINAL: the watch goes, the terminal stays
        // watched, in a watch of its own.
        const { worktree: _gone, ...kept } = member;
        next[ref] = {
          ...kept,
          work: moveToOwnWatch_1_68_0(
            ref,
            member,
            { id: work, work: recordOf(before[work]), stays: false },
            nextWorks,
          ),
          role: "other",
        };
        worksChanged = true;
        changed = true;
        continue;
      }
      const own = work === null ? undefined : watched.get(work);
      if (member === null) {
        next[ref] = value;
        continue;
      }
      const { worktree: _gone, ...kept } = member;
      if (work !== null && own !== undefined && ref !== own) {
        // ANOTHER TERMINAL IN A WATCH: it becomes a watch of its own.
        next[ref] = {
          ...kept,
          work: moveToOwnWatch_1_68_0(
            ref,
            member,
            { id: work, work: recordOf(nextWorks[work]), stays: true },
            nextWorks,
          ),
          role: "other",
        };
        worksChanged = true;
        changed = true;
        continue;
      }
      const role = own !== undefined ? "other" : member.role;
      if (!("worktree" in member) && role === member.role) {
        next[ref] = value;
        continue;
      }
      changed = true;
      next[ref] = { ...kept, role };
    }
    if (changed) nextMembers = next;
  }
  if (nextMembers !== null)
    store.set("members", nextMembers as unknown as PersistedState["members"]);
  if (worksChanged)
    store.set("works", nextWorks as unknown as PersistedState["works"]);
  const views = recordOf(store.get("workCodeViews"));
  if (views !== null && Object.keys(views).some((id) => gone.has(id)))
    store.set(
      "workCodeViews",
      Object.fromEntries(
        Object.entries(views).filter(([id]) => !gone.has(id)),
      ) as unknown as PersistedState["workCodeViews"],
    );
}

/** The migration ladder — hoisted so {@link decodeStateBackup}'s scratch
 *  store walks the REAL ladder on a backup snapshot (which may predate any
 *  rung), never a parallel re-implementation of it. */
export const CONF_MIGRATIONS = {
  // 1.1.0 legacy: sortOrder added to SavedTerminal. The field was
  // removed entirely in 1.18.0 (replaced by Map insertion order);
  // this migration stays as a no-op so users who walked through
  // earlier versions keep their ladder position intact.
  "1.1.0": () => {},
  // Preferences added — old state files don't have them.
  // conf auto-merges defaults, but explicit migration ensures clean shape.
  "1.2.0": (store: Conf<PersistedState>) => {
    if (!store.has("preferences")) {
      store.set("preferences", DEFAULT_PREFERENCES);
    }
  },
  // sidebarAgentPreviews added — old preference blobs lack this field.
  "1.3.0": (store: Conf<PersistedState>) => {
    const current = store.get("preferences") as
      | Partial<Preferences>
      | undefined;
    store.set("preferences", {
      ...DEFAULT_PREFERENCES,
      ...current,
    });
  },
  // sidebarAgentPreviews: boolean → enum. Field removed entirely in
  // 1.15.0 (#622); migrations preserved as historical record. The 1.15.0
  // pass strips the key from disk for any user that walked through these
  // earlier migrations.
  "1.4.0": (store: Conf<PersistedState>) => {
    const current = store.get("preferences") as unknown as
      | Record<string, unknown>
      | undefined;
    const old = current?.sidebarAgentPreviews;
    const migrated =
      old === true
        ? "agents"
        : old === false
          ? "none"
          : typeof old === "string"
            ? old
            : "attention";
    store.set("preferences", {
      ...DEFAULT_PREFERENCES,
      ...(current as Partial<Preferences>),
      sidebarAgentPreviews: migrated,
    } as unknown as Preferences);
  },
  // recentAgents added — seed as empty array for existing state files.
  // The `recentAgents` key was a top-level slot until 1.19.0 collapsed
  // it into `activityFeed.recentAgents`; the cast keeps this historical
  // migration valid against the post-1.19 schema.
  "1.5.0": (store: Conf<PersistedState>) => {
    const untyped = store as unknown as {
      has: (key: string) => boolean;
      set: (key: string, value: unknown) => void;
    };
    if (!untyped.has("recentAgents")) {
      untyped.set("recentAgents", []);
    }
  },
  // rightPanelCollapsed + rightPanelSize added — old preference blobs lack these fields.
  "1.6.0": (store: Conf<PersistedState>) => {
    const current = store.get("preferences") as
      | Partial<Preferences>
      | undefined;
    store.set("preferences", {
      ...DEFAULT_PREFERENCES,
      ...current,
    });
  },
  // rightPanel nested object replaces flat rightPanelCollapsed/rightPanelSize — discard old flat fields, use default rightPanel.
  "1.7.0": (store: Conf<PersistedState>) => {
    const current = store.get("preferences") as
      | Record<string, unknown>
      | undefined;
    const { rightPanelCollapsed, rightPanelSize, ...rest } = current ?? {};
    store.set("preferences", {
      ...DEFAULT_PREFERENCES,
      ...rest,
      rightPanel: DEFAULT_PREFERENCES.rightPanel,
    });
  },
  // RightPanelTab enum changed: "files" + "git" stubs collapsed into one "review" tab (#514).
  // Only acts on the legacy flat-string `tab` shape. The 1.13.0
  // migration converted that to a DU, and 1.20.0 flattened it again
  // into `activeTab` + `codeMode` — neither of those shapes has a
  // string `tab`, so the early-return skips them cleanly.
  "1.8.0": (store: Conf<PersistedState>) => {
    const current = store.get("preferences") as Record<string, unknown>;
    const rp = current.rightPanel as Record<string, unknown>;
    if (typeof rp.tab !== "string") return;
    const staleTab = rp.tab !== "inspector" && rp.tab !== "review";
    if (staleTab) {
      store.set("preferences", {
        ...current,
        rightPanel: { ...rp, tab: "inspector" },
      } as unknown as Preferences);
    }
  },
  // Tab renamed: "review" → "diff" (#514). Same string-tab guard as
  // 1.8.0 — only acts on the legacy flat-string shape.
  "1.9.0": (store: Conf<PersistedState>) => {
    const current = store.get("preferences") as Record<string, unknown>;
    const rp = current.rightPanel as Record<string, unknown>;
    if (typeof rp.tab !== "string") return;
    const next = rp.tab === "review" ? "diff" : rp.tab;
    const valid = next === "inspector" || next === "diff";
    store.set("preferences", {
      ...current,
      rightPanel: { ...rp, tab: valid ? next : "inspector" },
    } as unknown as Preferences);
  },
  // `randomTheme` (boolean) replaced by `shuffleTheme` (boolean). The
  // semantics changed under the hood — "shuffle" now uses a perceptual
  // distance picker instead of pure random, so collisions vanish — but
  // the user-facing on/off bit carries over verbatim.
  "1.10.0": (store: Conf<PersistedState>) => {
    const current = store.get("preferences") as unknown as
      | (Record<string, unknown> & { randomTheme?: unknown })
      | undefined;
    const { randomTheme, ...rest } = current ?? {};
    // `shuffleTheme` was itself later removed (→ `newTerminalTheme` in
    // 1.30.0), so its historical default is pinned as a literal here rather
    // than read off the current DEFAULT_PREFERENCES (which no longer carries
    // it). The 1.30.0 step converts whatever this writes.
    const shuffleTheme = typeof randomTheme === "boolean" ? randomTheme : true;
    store.set("preferences", {
      ...DEFAULT_PREFERENCES,
      ...(rest as Partial<Preferences>),
      shuffleTheme,
    });
  },
  // rightPanel.pinned added — default to true (docked) for existing users.
  "1.11.0": (store: Conf<PersistedState>) => {
    const current = store.get("preferences");
    if ((current.rightPanel as Record<string, unknown>).pinned === undefined) {
      store.set("preferences", {
        ...current,
        rightPanel: { ...current.rightPanel, pinned: true },
      });
    }
  },
  // canvasMode preference added — default to false (focus mode).
  // Field removed in 1.15.0 (#622). Historical migration preserved so
  // users walking the ladder don't lose any other preference fields.
  "1.12.0": (store: Conf<PersistedState>) => {
    const current = store.get("preferences") as Record<string, unknown>;
    if (current.canvasMode === undefined) {
      store.set("preferences", {
        ...current,
        canvasMode: false,
      } as unknown as Preferences);
    }
  },
  // rightPanel.tab string ("inspector" | "diff") → discriminated union.
  //   { tab: "inspector" | "diff" }
  //   →
  //   { tab: { kind: "inspector" } | { kind: "code", mode: "local"|"branch"|"browse" } }
  // Only acts on the string shape. Skips already-migrated DU stores
  // and the post-1.20.0 flat shape (no `tab` field at all). The
  // `_codeMode` strip drops any transient flat field from an
  // in-flight build of #576 — released versions never had it.
  "1.13.0": (store: Conf<PersistedState>) => {
    const current = store.get("preferences");
    const rp = current.rightPanel as Record<string, unknown>;
    if (typeof rp.tab !== "string") return;
    const tab =
      rp.tab === "diff"
        ? { kind: "code" as const, mode: "local" as const }
        : { kind: "inspector" as const };
    const { codeMode: _codeMode, tab: _tab, ...rest } = rp;
    store.set("preferences", {
      ...current,
      rightPanel: { ...rest, tab },
    } as unknown as Preferences);
  },
  // terminalRenderer preference added — default to "auto" (existing behavior:
  // WebGL on focused+visible tile, DOM elsewhere).
  "1.14.0": (store: Conf<PersistedState>) => {
    const current = store.get("preferences");
    if ((current as Record<string, unknown>).terminalRenderer === undefined) {
      store.set("preferences", { ...current, terminalRenderer: "auto" });
    }
  },
  // canvasMode + sidebarAgentPreviews removed (#622) — the workspace is
  // now mode-less (canvas always on desktop) and the sidebar with its
  // preview cards is gone, replaced by the floating workspace switcher.
  "1.15.0": (store: Conf<PersistedState>) => {
    const current = store.get("preferences") as Record<string, unknown>;
    const { canvasMode: _cm, sidebarAgentPreviews: _sap, ...rest } = current;
    store.set("preferences", rest as Preferences);
  },
  // terminalRenderer enum widened from ["auto","dom"] to ["auto","webgl","dom"].
  // Existing on-disk values ("auto" and "dom") are valid literals of the
  // widened enum, so no value transformation is required. The bump is
  // recorded here for the ladder's sake (see dev/skills/state/SKILL.md).
  "1.16.0": () => {},
  // rightPanel.pinned removed — the panel now always docks, so the
  // pin/overlay toggle (1.11.0) is gone. Strip the field from disk so
  // the 1.17.0 preferences shape matches the schema exactly.
  "1.17.0": (store: Conf<PersistedState>) => {
    const current = store.get("preferences");
    const rp = current.rightPanel as Record<string, unknown>;
    if (rp.pinned !== undefined) {
      const { pinned: _pinned, ...rest } = rp;
      store.set("preferences", {
        ...current,
        rightPanel: rest as typeof current.rightPanel,
      });
    }
  },
  // 1.18.0 transformed the saved SESSION's terminals (flat
  // `repoName`/`branch` → synthesized `GitInfo`). `session` left this store
  // at W2.2 (it is padi's now), so this is a no-op — the 1.31.0 strip removes
  // any legacy `session` residue rather than reshaping it here.
  "1.18.0": () => {},
  // 1.19.0 collapsed the top-level `recentRepos` + `recentAgents` keys into a
  // single `activityFeed` cell. `activityFeed` itself left this store at W2.2
  // (it is padi's now, stripped by 1.31.0 below), so the WRITE is gone — but
  // keep deleting the two pre-1.19 orphan keys, which 1.31.0's strip list does
  // not cover, so a jump from pre-1.19 straight to W2.3 still cleans them.
  "1.19.0": (store: Conf<PersistedState>) => {
    deleteLegacyKey(store, "recentRepos");
    deleteLegacyKey(store, "recentAgents");
  },
  // rightPanel.tab DU → flat `activeTab` + `codeMode`. Storage stays
  // mergeable by Solid's setStore (no DU subtree to leak variant
  // fields); `codeMode` now persists across Inspector↔Code toggles.
  // The DU view is reconstructed at consumption sites via
  // `rightPanelView()`. Corrupt/missing tab degrades to inspector/local.
  "1.20.0": (store: Conf<PersistedState>) => {
    const current = store.get("preferences") as Record<string, unknown>;
    const rp = current.rightPanel as Record<string, unknown>;
    const tab = rp.tab as
      | { kind: "inspector" }
      | { kind: "code"; mode: "local" | "branch" | "browse" }
      | undefined;
    const activeTab = tab?.kind === "code" ? "code" : "inspector";
    const codeMode = tab?.kind === "code" ? tab.mode : "local";
    const { tab: _tab, ...rest } = rp;
    // Cast through `unknown` — the transitional shape carries `activeTab`
    // and `codeMode` on `rightPanel` that 1.23.0 later strips, so the
    // value here is intentionally wider than `Preferences`.
    store.set("preferences", {
      ...current,
      rightPanel: { ...rest, activeTab, codeMode },
    } as unknown as Preferences);
  },
  // 1.21.0 seeded `SavedTerminal.lastActivityAt: 0` on legacy session
  // terminals (#830). `session` left this store at W2.2 (padi's now), so this
  // is a no-op — the 1.31.0 strip removes any legacy `session` residue.
  "1.21.0": () => {},
  // SavedTerminal.intent added — optional multiline-markdown annotation.
  // No backfill: the field is optional, so absent values continue to
  // read as "unset" through the tightened Zod schema (`.min(1).optional()`).
  // themeName was also tightened from `.optional()` to `.min(1).optional()`
  // in the same schema bump; legacy sessions that had `themeName: ""`
  // would now fail validation, but no path produced that shape — the
  // theme setter always wrote a non-empty value or omitted the key.
  "1.22.0": () => {},
  // Right-panel `activeTab` and `codeMode` move from the global
  // `preferences.rightPanel` to per-terminal `TerminalMetadata.rightPanel`
  // — the two fields are *about* what each terminal is doing, so they
  // should travel with the terminal. Strip them from the preferences
  // blob; new per-terminal records seed lazily from
  // `DEFAULT_RIGHT_PANEL_PER_TERMINAL` at first read. The CodeTab's
  // legacy `kolu-codetab-selected-files` localStorage key is dropped
  // client-side (no on-disk state to migrate).
  "1.23.0": (store: Conf<PersistedState>) => {
    const current = store.get("preferences") as Record<string, unknown>;
    const rp = current.rightPanel as Record<string, unknown> | undefined;
    if (!rp) return;
    const { activeTab: _activeTab, codeMode: _codeMode, ...rest } = rp;
    store.set("preferences", {
      ...current,
      rightPanel: rest as typeof current.rightPanel,
    } as Preferences);
  },
  // `rightPanel.codeTabTreeSize` (the Code tab's vertical split fraction)
  // was added to RightPanelPrefsSchema in #918 without a migration. Files
  // written before then carry a `rightPanel` with only `collapsed`/`size`,
  // so `preferences.get` failed Zod validation on the wire
  // (EVENT_ITERATOR_VALIDATION_FAILED) until the field was backfilled (#1237).
  "1.24.0": (store: Conf<PersistedState>) => {
    const current = store.get("preferences") as Record<string, unknown>;
    const rp = current.rightPanel as Record<string, unknown> | undefined;
    if (!rp || rp.codeTabTreeSize !== undefined) return;
    store.set("preferences", {
      ...current,
      rightPanel: {
        ...rp,
        codeTabTreeSize: DEFAULT_PREFERENCES.rightPanel.codeTabTreeSize,
      },
    } as Preferences);
  },
  // 1.25.0 backfilled `git.remoteUrl: null` (#1244), 1.26.0 backfilled
  // `location: local` (#1288), 1.27.0 backfilled the `state: active` arm
  // (sleeping-terminals Phase 1) — all on legacy SESSION terminals. `session`
  // left this store at W2.2 (padi's now), so these are no-ops; the 1.31.0
  // strip removes any legacy `session` residue rather than reshaping it here.
  "1.25.0": () => {},
  "1.26.0": () => {},
  "1.27.0": () => {},
  // `SavedTerminal.agentSession` added (the exact agent conversation ref —
  // `{ kind, id }` — captured for resume-by-id on wake/restore, juspay/kolu#1495).
  // The field is OPTIONAL, so a pre-1.28 record that lacks it parses cleanly and
  // simply falls back to the most-recent-conversation resume — no data to
  // backfill, no validation failure. The bump + this entry exist only to honor
  // the "persisted-shape change ⇒ migration ladder step" rule (dev/skills/state/SKILL.md).
  "1.28.0": () => {},
  // 1.29.0 ran the awareness-derive-store cutover (#1621) on legacy SESSION
  // terminals (backfilling `pr` + synthesizing `restoreTarget`). `session`
  // left this store at W2.2 (padi's now), so this is a no-op — the 1.31.0
  // strip removes any legacy `session` residue rather than reshaping it here.
  "1.29.0": () => {},
  // `shuffleTheme` (boolean) split into `newTerminalTheme` (inherit|shuffle)
  // + `shuffleBehavior` (random|dark|light|auto) — see
  // `migratePreferences_1_30_0` for the conversion (on→{shuffle,auto},
  // off→{inherit,auto}, legacy-field-wins ladder handling).
  "1.30.0": (store: Conf<PersistedState>) => {
    const current = store.get("preferences") as Record<string, unknown>;
    // `migratePreferences_1_30_0` self-guards (returns `current` untouched
    // when there's no legacy `shuffleTheme`), so no inline presence check.
    store.set(
      "preferences",
      migratePreferences_1_30_0(current) as unknown as Preferences,
    );
  },
  // The BURIAL (W2.3): strip the legacy `session` / `activityFeed` keys — and
  // the older orphan `sleepingTerminals` / `lastPairedDaemon` keys present on
  // real disks from earlier eras — off this store. `session`/`activityFeed`
  // moved to the padi PROCESS's own state-root at W2.2; this store keeps only
  // `preferences` now. BACKUP-FIRST (see `stripLegacyStateKeys_1_31_0`).
  "1.31.0": (store: Conf<PersistedState>) => stripLegacyStateKeys_1_31_0(store),
  // The new-terminal collapsed DEFAULT moved off `rightPanel.collapsed` (a
  // write-dead seed jammed next to live geometry) to a top-level
  // `newTerminalCollapsed` preference beside `newTerminalTheme`. Seed the new
  // top-level field from DEFAULT_PREFERENCES and strip the stale
  // `rightPanel.collapsed` key so the blob matches the schema exactly — same
  // spread-defaults shape as the 1.6.0/1.7.0 rightPanel steps.
  "1.32.0": (store: Conf<PersistedState>) => {
    store.set(
      "preferences",
      migratePreferences_1_32_0(
        store.get("preferences") as Record<string, unknown>,
      ) as unknown as Preferences,
    );
  },
  // W10 — `hosts` (the strip-added fleet) is now a field on the schema. Seed the empty
  // list onto an existing pre-W10 file so its on-disk shape matches PersistedStateSchema
  // exactly. conf's `defaults` already merges `[]` on read, so this is belt-and-suspenders
  // that also honors the "persisted-shape change ⇒ ladder step" rule (dev/skills/state/SKILL.md).
  // A genuine fleet is only ever written by the pool's `persist` hook, never here.
  "1.33.0": (store: Conf<PersistedState>) => {
    if (!store.has("hosts")) store.set("hosts", []);
  },
  // `activityAlerts` renamed to `attentionAlerts` (terminology standardization
  // on "attention"; same boolean, same `true` default). Carry the old value
  // forward so a user who turned alerts off keeps them off — see
  // `migratePreferences_1_34_0` for the rename (legacy-key-wins, drop-old).
  // NO new rung repairs a store that already walked this ladder while the
  // legacy key lost to a spread-injected default: that store now reads
  // `attentionAlerts: true` with no `activityAlerts` left, which is
  // byte-identical to a genuine `true`. The loss is undetectable, so it is
  // uncorrectable — only a blob still sitting BELOW 1.34.0 can be migrated
  // right, and this rung now does.
  "1.34.0": (store: Conf<PersistedState>) => {
    store.set(
      "preferences",
      migratePreferences_1_34_0(
        store.get("preferences") as Record<string, unknown>,
      ) as unknown as Preferences,
    );
  },
  // `ShuffleBehaviorSchema` gained `colourful` (saturated shuffle pool).
  // Existing records keep their prior `shuffleBehavior` string — no rewrite.
  // Ladder step only so a PreferencesSchema change advances SCHEMA_VERSION
  // (see dev/skills/state/SKILL.md).
  "1.35.0": () => {},
  // `viewerMode` — the browser's last-reported OS light/dark reading — is now a
  // field on the schema (it feeds the new-terminal theme policy kolu-server pushes
  // to padi). Seed the default onto an existing file so its on-disk shape matches
  // `PersistedStateSchema` exactly; conf's `defaults` already merges it on read,
  // so this honours the "persisted-shape change ⇒ ladder step" rule
  // (dev/skills/state/SKILL.md) rather than adding behaviour. A real reading is only
  // ever written by the `viewerMode` cell's store, never here.
  "1.36.0": (store: Conf<PersistedState>) => {
    if (!store.has("viewerMode")) store.set("viewerMode", "dark");
  },
  // `agentDistro` — the Agents setting (on/off + agent-distro profile) — is now a
  // preferences field. Spread the default in under an existing value, the same
  // spread-defaults shape as the 1.6.0/1.7.0 rightPanel steps, so an existing
  // user gets agents OFF (profile `vanilla`), exactly like a fresh install: an
  // upgrade changes nobody's PATH.
  "1.37.0": (store: Conf<PersistedState>) => {
    store.set(
      "preferences",
      migratePreferences_1_37_0(
        store.get("preferences") as Record<string, unknown>,
      ) as unknown as Preferences,
    );
  },
  // `agentDistro` is `null` until someone chooses (it decides the welcome step's
  // autofocus and Settings' "nothing chosen yet").
  // An Off record becomes `null` (it is 1.37's seed or a dev build's choice —
  // that setting never shipped in a release); an On record is kept whole.
  "1.38.0": (store: Conf<PersistedState>) => {
    store.set(
      "preferences",
      migratePreferences_1_38_0(
        store.get("preferences") as Record<string, unknown>,
      ) as unknown as Preferences,
    );
  },
  // `tipBarCollapsed` — the tile tip's size (bar or tab) — is now a
  // preferences field. Seed the full bar onto an existing record.
  "1.39.0": (store: Conf<PersistedState>) => {
    store.set(
      "preferences",
      migratePreferences_1_39_0(
        store.get("preferences") as Record<string, unknown>,
      ) as unknown as Preferences,
    );
  },
  // `agentProfilesRecent` — the Agents field's remembered profiles — joins
  // preferences, and a stored `juspay` (a bundle agent-distro no longer ships)
  // becomes Juspay's reference, `github:juspay/skills`.
  "1.40.0": (store: Conf<PersistedState>) => {
    store.set(
      "preferences",
      migratePreferences_1_40_0(
        store.get("preferences") as Record<string, unknown>,
      ) as unknown as Preferences,
    );
  },
  // The Agents setting's `profile` becomes `profiles`, the stack over
  // agent-distro's one package: `vanilla` (the harnesses alone) is the empty
  // stack, a reference its one entry.
  "1.41.0": (store: Conf<PersistedState>) => {
    store.set(
      "preferences",
      migratePreferences_1_41_0(
        store.get("preferences") as Record<string, unknown>,
      ) as unknown as Preferences,
    );
  },
  // Juspay's reference — once the never-chosen default — leaves the stack and
  // the remembered references: it is an explicit opt-in.
  "1.42.0": (store: Conf<PersistedState>) => {
    store.set(
      "preferences",
      migratePreferences_1_42_0(
        store.get("preferences") as Record<string, unknown>,
      ) as unknown as Preferences,
    );
  },
  // `hostOrder` — the host-tab arrangement the desktop strip drags — joins
  // preferences. Seed it empty onto an existing record: nobody has rearranged
  // yet, so the strip keeps pool order with the local host pinned first.
  "1.43.0": (store: Conf<PersistedState>) => {
    store.set(
      "preferences",
      migratePreferences_1_43_0(
        store.get("preferences") as Record<string, unknown>,
      ) as unknown as Preferences,
    );
  },
  // The CONDUCTOR moves in. kolu-server hosts kolu's one supervising
  // conversation now — one conversation over every host, rather than one per
  // padi — so the resumable half of it (session id, cwd, chosen model, the
  // transcript's tail, the fleet it touched) is a key on THIS store. Seed the
  // empty record onto an existing file so its on-disk shape matches
  // `PersistedStateSchema` exactly; conf's `defaults` already merges it on
  // read, so this honours the "persisted-shape change ⇒ ladder step" rule
  // (dev/skills/state/SKILL.md) rather than adding behaviour.
  //
  // IT SEEDS, IT DOES NOT IMPORT. padi's own `1.5.0` rung DELETES the matching
  // key from each host's state-root, and nothing is carried across: that
  // record was written by a different process, against a different `$HOME` and
  // a different MCP server, so a session id copied here would be one this
  // conversation cannot load and a transcript copied here would claim a
  // conversation that is not coming back. The conversation padi hosted never
  // shipped in a release, so the only transcripts this declines to inherit are
  // ones a development build wrote.
  //
  // NUMBERED 1.44.0 rather than 1.43.0: master took that rung for `hostOrder`
  // while this branch was open, and two rungs with one number is a store that
  // runs whichever handler the object literal happened to keep.
  "1.44.0": (store: Conf<PersistedState>) => {
    if (!store.has("conductor")) {
      store.set("conductor", EMPTY_PERSISTED_CONDUCTOR);
    }
  },
  // The conversation is RENAMED: it is the Conductor, and the key it persists
  // under is `conductor`. A store that walked 1.44.0 while this branch was
  // still calling it the orchestrator holds the SAME record under the old
  // name, and that record is a real conversation — a session id a person can
  // still resume, the transcript tail their chat reopens with, the fleet it
  // touched. So this rung MOVES it rather than reseeding: dropping the old key
  // and letting `defaults` supply an empty `conductor` would be a rename that
  // silently ate somebody's chat, which is exactly the failure the ladder
  // exists to prevent (dev/skills/state/SKILL.md).
  //
  // Shape-identical, so the value carries across verbatim — this is a key
  // rename, not a schema change, and the record it moves is validated by the
  // same `PersistedConductorSchema` it was written against. The OLD KEY'S
  // PRESENCE is what decides: a file that still has it has not walked this
  // rung, so what sits under the new name is nothing, or the empty record
  // 1.44.0 seeded — never a conversation worth keeping over this one. The old
  // key is deleted afterwards, so the file does not keep a stale copy of a
  // conversation nothing reads.
  //
  // THE ATTACHMENTS MOVE WITH IT. The record keeps rows, and a user row may
  // name a file this server wrote beside `config.json` — under the corner the
  // conversation is named after. So the corner is renamed in the same step
  // and the rows are re-pointed at it: leaving the directory behind would
  // park a person's pasted screenshots where nothing sweeps and nothing
  // writes, and moving it without re-pointing would leave every chip in the
  // transcript naming an address that no longer exists. Both corners already
  // present means a build has been writing to the new one — the files there
  // are the live set, so the old corner is left alone rather than merged over
  // it, and the paths stay true to where their bytes actually are.
  //
  // A failed move is WARNED about rather than thrown from, on the reasoning
  // the conductor's own attachment sweep uses: what is at stake is disk, and
  // refusing to boot over it would cost the conversation. The re-point is
  // skipped with it, so the record keeps pointing at the bytes that are
  // really there.
  "1.45.0": (store: Conf<PersistedState>) => {
    renameLegacyKey(store, "orchestrator", "conductor");
    const root = dirname(store.path);
    const from = join(root, "orchestrator");
    const to = join(root, "conductor");
    if (!existsSync(from) || existsSync(to)) return;
    try {
      renameSync(from, to);
    } catch (err) {
      log.warn(
        { err, from, to },
        "kolu-server: the conductor's attachments could not be moved to their new corner",
      );
      return;
    }
    // Frozen history: at this rung the rows still live in config.json's
    // `conductor` key (1.50.0 is what moves them to the transcript file), so
    // the key is read as the shape it had THEN.
    const record = store.get("conductor") as unknown as Record<
      string,
      unknown
    > & { rows?: ReadonlyArray<ConductorRow> };
    if (record.rows === undefined) return;
    store.set("conductor", {
      ...record,
      ...repointConductorAttachments({ rows: record.rows }, from, to),
    } as unknown as PersistedState["conductor"]);
  },
  // THE CONDUCTOR'S WATCH LIST — the terminals kolu wakes it about — is saved
  // with the conversation now, so the record grows a `watched` key. A file
  // written before this rung has no such key, and the conductor's schema would
  // refuse it on read: the ladder's whole job is that an existing state root
  // keeps working, so the key is seeded EMPTY, which is the truth about a
  // conversation that has never watched anything.
  //
  // Numbered 1.49.0, not the 1.46.0 that follows 1.45.0: this ONE rung walks
  // every shape the watch list has ever had on disk through to the current
  // one. Builds before its release stamped 1.46.0 on files whose entries
  // carry only `ref`/`name`/`agent`/`told`, 1.47.0 on files whose entries
  // have no `root`, and 1.48.0 — a number a running install is sitting on —
  // on files whose entries have no `since`. A rung numbered at or below a
  // file's own version never runs, so the number moves UP with the shape
  // rather than a second rung being added beside this one.
  //
  // THAT LICENCE COVERED THIS PR'S OWN PRE-RELEASE STAMPS AND EXPIRES WITH
  // THEM: once 1.49.0 has shipped, a file in the wild says 1.49.0 and a rung
  // renumbered past it would run again over a record it has already walked.
  // The next shape change after the release gets a NEW rung beside this one,
  // never a bigger number on this one.
  //
  // AND "RELEASE" HERE MEANS THE FIRST DEPLOY, NOT THE MERGE — the narrower
  // reading this licence was always owed, and the one `dev/skills/state`
  // states as the rule. A branch somebody is running has already stamped its
  // numbers on their disk, so renumbering a rung on an unmerged branch is the
  // same mistake as renumbering a shipped one. #2376 paid for the wider
  // reading with a Conductor that would not load; 1.52.0 is the rung that had
  // to be written afterwards.
  //
  // The rung completes each entry with the reading that claims nothing it did
  // not see — `joined: "asked"` (no command kolu typed), `spoken: false`,
  // `ran: false`, and `root: null` (nothing has read the terminal's host, so
  // which piece of work it is part of is not yet known; the first reading
  // after the boot says). Those values are FROZEN HISTORY, not a mirror of
  // `kolu-conductor`'s `watchEntry()`: they are what completes the files
  // these shapes were written by, and they stay as they are when a fresh
  // entry's empty values move.
  //
  // `since` IS THE MOMENT THIS RUNG RUNS, and that is a deliberate choice
  // between two wrong answers. The join time was never written down, so the
  // alternatives are an invented past (claiming a piece of work is older than
  // anything kolu can show) and the epoch (a panel reading "56y"). The boot
  // that upgrades the file is the earliest instant kolu can honestly vouch
  // for: the duration it starts counting is "at least this long", and it is
  // right from the next terminal joining onwards. One stamp for every entry
  // in the file, read once, so two terminals watched together keep reading as
  // one piece of work rather than drifting apart by the loop's own
  // milliseconds.
  //
  // The record is otherwise untouched: the session id, the transcript tail,
  // the fleet and the model a person chose all carry across unchanged, because
  // this is an addition and not a reshape.
  "1.49.0": (store: Conf<PersistedState>) => {
    // Read as an OBJECT rather than as the decoded record: this rung runs
    // against a file written by an older build, whose `conductor` key is
    // exactly the shape the current schema does not yet accept.
    const record = store.get("conductor") as
      | Record<string, unknown>
      | undefined;
    if (record === undefined) return;
    const watched = record.watched;
    // A `watched` that is there and is not a list is not an older shape —
    // it is a broken file, left as it is so the read refuses it by name.
    if (watched !== undefined && !Array.isArray(watched)) return;
    const now = new Date().toISOString();
    store.set("conductor", {
      ...record,
      watched: (watched ?? []).map((entry: Record<string, unknown>) => ({
        joined: "asked",
        spoken: false,
        ran: false,
        root: null,
        since: now,
        ...entry,
      })),
    } as unknown as PersistedState["conductor"]);
  },
  // A PIECE OF WORK IS A STORED THING — and the transcript is a file of its
  // own. The `conductor` key loses `rows` (to
  // `<stateDir>/conductor/transcript.json`) and `watched` (to the new `works`
  // key, one work per group the watching panel drew). Both moves and the
  // grouping decision are argued at
  // {@link migrateConductorToWorks_1_50_0} / {@link worksFromWatched_1_50_0}.
  //
  // This rung also RETIRES the licence 1.49.0 took to renumber itself past
  // this branch's pre-release stamps: 1.49.0 has shipped, so the next shape
  // change is a rung beside it rather than a bigger number on it. A file
  // sitting at any number below 1.50.0 reaches here with a `conductor` key in
  // the shape 1.49.0 guarantees — rows, watched entries complete — which is
  // exactly what this one reads.
  "1.50.0": migrateConductorToWorks_1_50_0,
  // THE PING-PONG, SWEPT OUT OF WHAT IS ALREADY SAVED. Two members in one
  // worktree reading one pull request thirty seconds apart wrote a check
  // event per frame for as long as they disagreed; the observer now keeps
  // one per kind per head commit, and this rung applies that same rule to the
  // works on disk (`collapseFlappingChecks_1_51_0` says exactly what it
  // keeps). Nothing else about a work is read or rewritten, and the
  // transcript file is untouched — so TRANSCRIPT_FILE_VERSION stays where it
  // is.
  "1.51.0": collapseFlappingChecks_1_51_0,
  // A STORE THIS BRANCH WROTE BEFORE ITS MEMBER BOOKKEEPING MOVED. A work
  // member's `watch` goes to the top-level `members` record, the member gains
  // `worktree`, a decision gains `header` and `file` — and a store already in
  // that shape passes through. `memberWatchOutOfWorks_1_52_0` argues the
  // order against 1.51.0 and why this is a new number: a rung that has run on
  // somebody's store is never edited.
  "1.52.0": memberWatchOutOfWorks_1_52_0,
  // THREE CARDS FOR ONE BRANCH BECOME ONE WORK. A work is its branch now
  // (`kolu-work`'s `WorkKey`), the works key is a record keyed by that
  // identity, the members are one map keyed by terminal, an event carries a
  // typed payload and there is no `abandoned` ending — so a store written
  // before this is folded into that shape by `foldWorksByKey_1_53_0`, which
  // argues every choice it makes. The transcript file moves in the same rung
  // (a work question is its own row kind), which is why
  // TRANSCRIPT_FILE_VERSION reads 1.53.0.
  "1.53.0": foldWorks_1_53_0,
  // A ROLE'S HARNESS AND ITS MODEL ARE KOLU'S OPTIONS TO DRAW, so those four
  // decisions lose the `options`/`multiple` the Conductor used to offer —
  // which is what keeps a work opened before the change, with an OPEN setup
  // question, answerable at all. `dropKoluChoiceOptions_1_54_0` argues it;
  // answered decisions keep their `answer.picked`, which is what the readings
  // read. The transcript file's rows do not change, so
  // TRANSCRIPT_FILE_VERSION stays at 1.53.0.
  "1.54.0": dropKoluChoiceOptions_1_54_0,
  // NO HOLE IN THE WORK MODEL. "Answered, with no answer" was a value a
  // store could hold — and the human's does — so a work could neither start
  // nor be asked again. Every decision, every event and every member walks to
  // the tagged sums that cannot say it: `workArmsNotNulls_1_55_0` argues each
  // rewrite, and the one that matters is an empty answer on an OPEN work
  // becoming the question it always was, still ASKED, in the same ask. The
  // transcript file moves in the same rung — a `work-ask` row's ask carries a
  // STANDING now (`workAskStanding_1_55_0`) — which is why
  // TRANSCRIPT_FILE_VERSION reads 1.55.0.
  "1.55.0": workArmsNotNulls_1_55_0,
  // HOW A KOLU CHOICE WAS CHOSEN. An answer to one of kolu's own questions
  // gains `chosen` — `picked` or `typed` — because the two are judged
  // differently: a typed model goes to the harness as typed and is never
  // held to the host's list. Every stored answer becomes `picked`, which is
  // what each was judged as (`koluChoicesSayHowChosen_1_56_0` argues it).
  // The transcript file is untouched, so TRANSCRIPT_FILE_VERSION stays at
  // 1.55.0.
  "1.56.0": koluChoicesSayHowChosen_1_56_0,
  // A PULL REQUEST'S ADDRESS AND THE FORGE'S MERGE ANSWER. `pr-opened` gains
  // `url` (`unrecorded` for every saved one: nothing to take it from), and
  // each saved `checks-passed` is followed by the `merge-state` it then
  // meant, so green reads as it did (`prFactsOnTheTimeline_1_57_0` argues
  // both). The transcript file is untouched, so TRANSCRIPT_FILE_VERSION
  // stays at 1.55.0.
  "1.57.0": prFactsOnTheTimeline_1_57_0,
  // A MENTION SAYS WHAT IT IS — a terminal or a piece of work. Every saved
  // mention was a terminal and gains `kind: "terminal"`
  // (`mentionsSayTheirKind_1_58_0`). Only the transcript file moves, which is
  // why TRANSCRIPT_FILE_VERSION reads 1.58.0; `config.json` is untouched.
  "1.58.0": (store: Conf<PersistedState>) =>
    mentionsSayTheirKind_1_58_0(dirname(store.path)),
  // A TOOL ROW GAINS `resumed` — when the CURRENT outing of a call began, for a
  // subagent that was sent more work after reporting (`toolOutings_1_59_0`
  // argues why nothing is rewritten). Only the transcript file's stamp moves,
  // which is why TRANSCRIPT_FILE_VERSION reads 1.59.0; `config.json` is
  // untouched.
  "1.59.0": (store: Conf<PersistedState>) =>
    toolOutings_1_59_0(dirname(store.path)),
  // THE CONVERSATION REMEMBERS WHETHER IT HAS BEEN TAUGHT. The `conductor`
  // key gains `taught` — whether the standing prompt has already gone out
  // under a message of the session it names — so a kolu-server restart stops
  // putting that prompt back into the middle of a chat in progress. A
  // required field, so a record written before this one does not decode
  // without a rung.
  //
  // FALSE for every saved record, which is the safe direction and not the
  // true-for-most one: this rung cannot see whether the remembered session
  // ever had a message, and a `true` written over one that had none would be
  // a conversation that is never taught at all. `false` costs one standing
  // prompt, on the first message after the upgrade, and nothing after that.
  // The transcript file is untouched, so TRANSCRIPT_FILE_VERSION stays at
  // 1.59.0.
  "1.60.0": (store: Conf<PersistedState>) => {
    // Read as an OBJECT rather than as the decoded record: this rung runs
    // against a file written by an older build, whose `conductor` key is
    // exactly the shape the current schema does not yet accept.
    const record = store.get("conductor") as
      | Record<string, unknown>
      | undefined;
    if (record === undefined) return;
    store.set("conductor", {
      taught: false,
      ...record,
    } as unknown as PersistedState["conductor"]);
  },
  // A PULL REQUEST SAYS WHETHER IT IS A DRAFT. `pr-opened` gains `draft`
  // (`unrecorded` for every saved one: kolu kept no record, and a rung does
  // not ask GitHub), and `draft-state` joins the event kinds
  // (`prOpenedSaysDraft_1_61_0` argues it). The transcript file is untouched,
  // so TRANSCRIPT_FILE_VERSION stays at 1.59.0.
  "1.61.0": prOpenedSaysDraft_1_61_0,
  "1.62.0": (store: Conf<PersistedState>) =>
    compactionRows_1_62_0(dirname(store.path)),
  "1.63.0": memory_1_63_0,
  // A WORK KEEPS ITS WORKTREE. A work gains `worktree`, given from its first
  // member whose saved worktree was read (`workKeepsItsWorktree_1_64_0`
  // argues each case). The transcript file is untouched, so
  // TRANSCRIPT_FILE_VERSION stays at 1.63.0.
  "1.64.0": workKeepsItsWorktree_1_64_0,
  // WHERE EACH WORK'S CODE VIEW STANDS: a `workCodeViews` key, seeded empty
  // (`workCodeViews_1_65_0`).
  "1.65.0": workCodeViews_1_65_0,
  // WHERE THE CONDUCTOR COMPACTS ITS CONVERSATION joins preferences, seeded at
  // the 200000 every earlier build used (`migratePreferences_1_66_0`). The
  // transcript file is untouched, so TRANSCRIPT_FILE_VERSION stays at 1.63.0.
  "1.66.0": (store: Conf<PersistedState>) => {
    store.set(
      "preferences",
      migratePreferences_1_66_0(
        store.get("preferences") as Record<string, unknown>,
      ) as unknown as Preferences,
    );
  },
  // WHO HOLDS A WORK IS RECORDED FROM HERE ON: every saved work gains one
  // `hand-offs-kept` event at its end, so the replay says the build and the
  // review it cannot know were not recorded (`handOffsKept_1_67_0`). The
  // transcript file is untouched, so TRANSCRIPT_FILE_VERSION stays at 1.63.0.
  "1.67.0": handOffsKept_1_67_0,
  // A WORK'S FACTS ARE THE WORK'S: its folder is git's answer for its key, so
  // every saved work's is unread and no member carries one
  // (`workFactsAreTheWorks_1_68_0` argues each step). The transcript file is
  // untouched, so TRANSCRIPT_FILE_VERSION stays at 1.63.0.
  "1.68.0": workFactsAreTheWorks_1_68_0,
};
