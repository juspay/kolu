/**
 * kolu-server's face of the state-backup ring (#1658) — the domain half behind
 * the `server/backups/*` root procedures. The generic ring mechanics live in
 * `kolu-shared`'s `stateBackup.ts` (shared with padi's own ring); THIS module
 * knows what a kolu-server snapshot MEANS: `preferences` / `hosts` /
 * `viewerMode` / the Conductor's `works`, summarized by the fleet size and the
 * number of works (`hosts` and `works` are the store's real user data).
 *
 * Restore is IN-PROCESS — no server restart. Unlike padi's session (data that
 * maps to live terminal processes, restored through the import/respawn
 * machinery), this store is plain data served from cells: the ring's own
 * {@link StateBackupRing.restore} gates the name, reads the snapshot and takes
 * the undo snapshot, then this module validates through the real migration
 * ladder on a scratch copy (`decodeStateBackup`, from the value the ring read), pushes
 * `preferences`/`viewerMode` through their cells' server-internal writers (every
 * connected client updates reactively, and the cell write persists through the
 * same conf path as any other change), and CONVERGES the host pool onto the
 * snapshot's fleet through the same pool add/remove the selector strip uses —
 * membership is a pool fact with the pool as its one writer, so a restore that
 * wrote the `hosts` key behind the pool's back would fork that authority. The
 * Conductor's `works` go the same way for the same reason — through the live
 * host's `restoreWorks`, which is their one writer while this process runs.
 */

import type { StateBackupEntry } from "kolu-shared/state-backup";
import type {
  ServerBackupsList,
  ServerBackupsRestoreResult,
  ServerStateBackup,
} from "kolu-common/contract";
import type { Preferences, ViewerMode } from "kolu-common/surface";
import type { PersistedWorks } from "kolu-conductor";
import { log } from "./log.ts";
import {
  type DecodedStateBackup,
  decodeStateBackup,
  stateBackupRing,
} from "./state.ts";

/** The ring's own entry shape and the wire's agree field-for-field — the
 *  `...entry` spread below type-checks BECAUSE of this line, not by coincidence.
 *  `kolu-common` carries no `kolu-shared` dependency (and `kolu-shared` no
 *  `effect` one), so one shared schema is not reachable; this is the tie that
 *  is. */
type _RingEntryMatchesWire =
  StateBackupEntry extends Omit<ServerStateBackup, "summary">
    ? true
    : ["wire shape drifted from kolu-shared's StateBackupEntry"];
const _ringEntryMatchesWire: _RingEntryMatchesWire = true;
void _ringEntryMatchesWire;

/** `server/backups/list` — the ring, newest first, each snapshot summarized by
 *  its fleet size and how many pieces of work it holds (the two things in this
 *  store a person recognizes a snapshot by). A snapshot that fails to parse is
 *  LISTED as `unreadable` rather than collapsing the enumeration (the ring owns
 *  that policy); the restore side still refuses it loudly. */
export function listServerStateBackups(): ServerBackupsList {
  return {
    backups: stateBackupRing.listWith<ServerStateBackup["summary"]>(
      (raw) => {
        const hosts = (raw as { hosts?: unknown }).hosts;
        const works = (raw as { works?: unknown }).works;
        // A pre-W10 snapshot has no `hosts` key — an honest zero-guest fleet;
        // a pre-1.50.0 one has no `works` key, and had no works to hold.
        return {
          kind: "state",
          hosts: Array.isArray(hosts) ? hosts.length : 0,
          works: Array.isArray(works) ? works.length : 0,
        };
      },
      { kind: "unreadable" },
    ),
  };
}

/** The seams a restore drives, injected from the boot (`index.ts`) — the cell
 *  writers `implementKoluSurface` returns and the pool's own membership verbs. */
export interface RestoreServerStateBackupDeps {
  /** Server-internal cell writers — publish to every client AND persist through
   *  the same conf path as a wire write (dedupe + `onWrite` policy nudge ride
   *  along). */
  setPreferences: (value: Preferences) => void;
  setViewerMode: (value: ViewerMode) => void;
  /** The persisted guest fleet (encoded keys) as of now — the convergence
   *  BASELINE, because that is the projection the snapshot's `hosts` field is
   *  comparable to (both exclude the unremovable local host). */
  currentHostKeys: () => readonly string[];
  /** Is this key already a LIVE pool member? The baseline above is the PERSISTED
   *  set, but `pool.add` throws "host already exists" on a key that is already
   *  live — and a `KOLU_PADI_HOST` env seed is deliberately live-but-unpersisted
   *  (`hostPersistence.ts`: "an env seed is a DECLARATIVE knob, not a membership
   *  fact"). Both facts must be consulted, or restoring a snapshot that names a
   *  seeded host reports a failure that never happened. */
  hasLiveHost: (key: string) => boolean;
  /** The pool's own membership verbs, by ENCODED key — the same path the
   *  strip's `hosts/add` / `hosts/remove` take, persist hook included. */
  addHostKey: (key: string) => Promise<void>;
  removeHostKey: (key: string) => Promise<void>;
  /** THE CONDUCTOR'S WORKS, replaced wholesale by the snapshot's. The live
   *  host is the one writer of that key while this process runs, so a restore
   *  that wrote it behind the host's back would be overwritten by the host's
   *  own throttled save within the second — this hands the snapshot TO the
   *  host, which drops the open asks on them, republishes, writes the key now
   *  and re-scopes the watch. */
  restoreWorks: (works: PersistedWorks) => void;
}

/** Every persisted key has a restore path: `preferences` and `viewerMode`
 *  through their cell writers above, `hosts` through the pool convergence below.
 *  A new key on the persisted shape breaks THIS line until it gets one —
 *  otherwise a "restore" would silently leave that key at its live value while
 *  telling the user it succeeded, which is the exact silent-overwrite class the
 *  ring exists to prevent.
 *
 *  `conductor` is the one deliberate exception, excluded rather than given a
 *  path because it cannot have one that means anything: the conversation's
 *  OTHER HALF lives in the agent's own session store, which kolu does not back
 *  up. Restoring kolu's session id or its rows alone would show a conversation
 *  the agent does not remember — or resume, under a live agent, a session it is
 *  not in. Nothing a person can lose rides on it either: the agent replays its
 *  half on `session/load`, and kolu's half is on screen in front of the person
 *  pressing restore. The works, which outlive any conversation, ARE restored
 *  (`restoreWorks` above).
 *
 *  Two things a work refers to are outside the ring and say so in the dialog:
 *  the transcript FILE (`<stateDir>/conductor/transcript.json` — the ring
 *  snapshots `config.json`'s bytes and nothing else) and the KEPT FILES under
 *  `<stateDir>/works/` (copies of worktree files on disk, not state). A
 *  restored finished work whose kept files were swept since reads them as
 *  gone, plainly. */
type UnrestoredPersistedKey = Exclude<
  keyof DecodedStateBackup,
  "preferences" | "viewerMode" | "hosts" | "works" | "conductor"
>;
const _everyPersistedKeyRestored: [UnrestoredPersistedKey] extends [never]
  ? true
  : ["restore path missing for", UnrestoredPersistedKey] = true;
void _everyPersistedKeyRestored;

/** `server/backups/restore` — restore one ring snapshot in-process. Fail-fast on
 *  every anomaly BEFORE anything is applied (name gate, unreadable bytes, a
 *  failed undo snapshot, scratch-migrate, schema decode). Host-pool convergence
 *  attempts EVERY diff and then NAMES the failures in the answer: the restore is
 *  not atomic (the cells apply before the pool converges), so a partial
 *  convergence is a fact the caller renders, not a throw that would tell a user
 *  recovering from data loss that nothing happened. */
export async function restoreServerStateBackup(
  input: { file: string },
  deps: RestoreServerStateBackupDeps,
): Promise<ServerBackupsRestoreResult> {
  // The ring gates the name, reads the snapshot and takes the pre-restore undo
  // snapshot (refusing outright if that snapshot fails) before `apply` runs.
  return await stateBackupRing.restore(input.file, async (raw) => {
    // Validate FULLY before applying anything — a throw here leaves the live
    // state untouched. Decoded from the VALUE the ring already read, never by
    // re-reading the member's path (which the undo snapshot's prune could race).
    const decoded = decodeStateBackup(raw, input.file);
    log.info({ file: input.file }, "restoring server state from backup");
    deps.setPreferences(decoded.preferences);
    deps.setViewerMode(decoded.viewerMode);
    // ... and the Conductor's works, handed to the live host rather than
    // written to the key under it: it is the one writer of that key while this
    // process runs, and it has to act on the restored set (drop the asks
    // nobody can answer, publish, re-scope the watch) for the restore to be
    // anything a person can see.
    deps.restoreWorks(decoded.works);

    // Converge the pool onto the snapshot's fleet. The ADD phase completes
    // before the REMOVE phase begins (a dial failure must not leave the fleet
    // emptier than either state), but WITHIN a phase the hosts are independent
    // ssh dials — run them concurrently so restore latency scales with the
    // slowest host, not the fleet size. `attempt` never rejects (it answers the
    // failure line), so a plain `Promise.all` collects every outcome.
    const target = new Set(decoded.hosts);
    const current = new Set(deps.currentHostKeys());
    const attempt = async (
      verb: "add" | "remove",
      key: string,
      run: (key: string) => Promise<void>,
    ): Promise<string | null> => {
      try {
        await run(key);
        return null;
      } catch (err) {
        log.error({ err, host: key }, `state restore: host ${verb} failed`);
        return `${verb} ${key}: ${err instanceof Error ? err.message : String(err)}`;
      }
    };
    const addFailures = await Promise.all(
      decoded.hosts
        .filter((key) => !current.has(key) && !deps.hasLiveHost(key))
        .map((key) => attempt("add", key, deps.addHostKey)),
    );
    const removeFailures = await Promise.all(
      [...current]
        .filter((key) => !target.has(key))
        .map((key) => attempt("remove", key, deps.removeHostKey)),
    );
    return {
      hostFailures: [...addFailures, ...removeFailures].filter(
        (failure): failure is string => failure !== null,
      ),
    };
  });
}
