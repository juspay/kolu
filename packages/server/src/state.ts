/**
 * THE LIVE STATE ROOT — where kolu-server's store is, and the one `Conf`
 * instance every domain module reads through.
 *
 * This module has module-level EFFECTS, and that is its whole job: it
 * validates `KOLU_STATE_DIR`, opens the state-backup ring and takes the boot
 * snapshot, constructs the `store` (wired with the shape's defaults and the
 * ladder's migrations, so opening it walks the ladder), and logs a
 * schema-invalid store at startup. Importing it opens a store.
 *
 * The two halves it is wired from are pure, and live beside it:
 * `stateShape.ts` (what the disk holds and at which version) and
 * `stateLadder.ts` (every rung this store has ever climbed, frozen). Neither
 * imports this file, so a rung can be exercised without a state root.
 *
 * Stores recoverable state at ~/.config/kolu/state.json (or wherever
 * KOLU_STATE_DIR points). `conf` is FAIL-FAST: a corrupt/unparseable store
 * THROWS on read (`clearInvalidConfig` is false; conf 15's default), it does
 * NOT silently reset to defaults — so a corrupt store fails loud rather than
 * emptying the fleet. A MISSING file is a fresh install (empty → defaults
 * merge in); a PRESENT-but-corrupt one crashes the boot.
 */

import {
  chmodSync,
  existsSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Conf from "conf";
import { Result } from "effect";
import { openStateBackupRing } from "kolu-shared/state-backup";
import { log } from "./log.ts";
import { CONF_MIGRATIONS } from "./stateLadder.ts";
import {
  CONF_DEFAULTS,
  decodePersistedState,
  type PersistedState,
  type PersistedStateSchema,
  readPersistedRecord,
  SCHEMA_VERSION,
} from "./stateShape.ts";

// Callers must pass an explicit directory via KOLU_STATE_DIR. A bare launch
// with no env would silently clobber whatever happens to live at conf's
// default path, so we refuse. Each entrypoint picks its own location:
//   nix-built kolu → ~/.config/kolu (production)
//   pnpm dev       → <worktree-root>/.kolu-dev (per-worktree, gitignored)
//   tests          → an ephemeral $TMPDIR path
const rawStateDir = process.env.KOLU_STATE_DIR;
if (!rawStateDir) {
  throw new Error(
    "KOLU_STATE_DIR must be set to an absolute directory. The nix-built " +
      "kolu wrapper, `pnpm dev`, and the test harness each set their own — " +
      "bare launches are rejected to avoid clobbering production state.",
  );
}

/** The validated state root (`KOLU_STATE_DIR`) — the single place that decides where the
 *  conf store lives (its `cwd`, below). Internal: with W10's `hosts` folded INTO the conf
 *  store (no longer a standalone `hosts.json` beside `config.json`), nothing outside this
 *  module keeps its own file under the root, so none needs the raw path. */
const stateDir: string = rawStateDir;

log.info({ path: stateDir }, "state directory");

/** kolu-server's state-backup ring (#1658) — the one binding every ring verb
 *  rides (boot snapshot here, the daily tick from `bootKoluWeb`, list/restore
 *  from `stateBackups.ts`). Opening it reads nothing and arms nothing.
 *
 *  IT COVERS `config.json` AND NOTHING ELSE — the ring snapshots one file's
 *  bytes. Two things kolu keeps under this same root are therefore outside it,
 *  deliberately:
 *
 *   - the CONDUCTOR'S TRANSCRIPT (`conductor/transcript.json`): it is most of
 *     the conversation's bytes and it moves on every keystroke, so ringing it
 *     would churn the ring for a record whose other half — the agent's own
 *     session store — kolu does not back up anyway. Restoring kolu's rows
 *     alone would show a conversation the agent does not remember.
 *   - the KEPT FILES (`works/<work>/…`): copies of worktree files, not state.
 *     They are bytes a work produced, bounded by nothing kolu chose, and a
 *     restore that brought back a `works` key naming files on disk is honest
 *     about the ones that have been swept since — the card reads them as gone.
 *
 *  The restore dialog says both of these in so many words
 *  (`stateBackups.ts`). */
export const stateBackupRing = openStateBackupRing(
  join(stateDir, "config.json"),
  log,
);

// Snapshot the pre-existing store into the backup ring BEFORE the `Conf`
// construction below can write it — the ladder itself rewrites the file, so a
// later snapshot would capture post-migration bytes (juspay/kolu#1658; padi's
// `openPadiStateStores` takes the same boot snapshot of ITS store). Fail-soft by
// design — see `kolu-shared`'s `stateBackup` module doc for why this one path
// may not throw.
//
// The daily re-snapshot tick is NOT armed here: it is armed by `bootKoluWeb`
// (`index.ts`), at boot altitude, so merely IMPORTING this module — which every
// unit test touching the store does — cannot start a process-lifetime timer.
// padi's `daemonMain` makes exactly the same split, for the same reason.
stateBackupRing.snapshot();

export const store = new Conf<PersistedState>({
  cwd: stateDir,
  projectVersion: SCHEMA_VERSION,
  // Owner-only (0600). `hosts` holds ssh targets (`user@host` keys), so the store must
  // not inherit the ambient umask's usually-world-readable 0644 — the same protection the
  // pre-W10 standalone `hosts.json` carried before the fleet folded in here. This covers
  // every atomic write conf makes (it writes a fresh temp file each time, so the mode
  // applies on every rewrite, not just first creation); a store left at a looser mode by a
  // pre-1.33 boot is tightened by the `chmodSync` below.
  configFileMode: 0o600,
  defaults: CONF_DEFAULTS,
  migrations: CONF_MIGRATIONS,
});

// Tighten a store that already exists at a looser mode. `configFileMode` only stamps a
// file conf itself writes, so a `config.json` created by a pre-1.33 boot (before this
// module set 0600) can still be sitting at a world-readable 0644 with ssh targets in it.
// Force it owner-only now, at module load, so the `hosts` protection is real immediately
// rather than only after the next incidental write.
if (existsSync(store.path)) chmodSync(store.path, 0o600);

// Early validation so a schema-invalid store shows up in journalctl immediately at
// startup, not only when the first client connects. Validates the on-disk shape of
// both domains — `preferences.ts` and `hostPersistence.ts` trust the validated store
// thereafter. This is a LOG, not the fail-loud gate: an unparseable store already
// threw in conf's own read above (fail-fast; `clearInvalidConfig` is false), and an
// invalid `hosts` value additionally crashes the boot loud where it's read
// (`getPersistedHosts`). No "delete to reset" advice: `hosts` is user data, so blindly
// deleting the store would empty the fleet — the offending domain must be fixed.
const result = decodePersistedState(readPersistedRecord(store));
if (Result.isFailure(result)) {
  // Effect's `SchemaError` renders as a path-annotated tree, so the ONE string
  // carries what zod's `issues.map(i => …)` summary spelled by hand — every
  // failing path and its message. Kept on both the message and the structured
  // field so `journalctl -o json` and a plain tail read the same thing.
  const summary = String(result.failure);
  log.error(
    { issue: summary, path: store.path },
    `Persisted state does not match schema (${summary}) at ${store.path}.`,
  );
}

/** The DECODED shape a backup restore hands back — the FULL persisted shape,
 *  ALIASED off the (deliberately unexported) `PersistedStateSchema` rather than
 *  re-listed, so a new persisted key cannot land without the restore path seeing
 *  it. Per `dev/skills/state/SKILL.md` consumers reach the disk shape through
 *  domain accessors; this is the restore path's one. */
export type DecodedStateBackup = typeof PersistedStateSchema.Type;

/** Decode ONE state-backup snapshot's PARSED value (#1658) into the CURRENT
 *  persisted shape by walking the REAL migration ladder on a SCRATCH copy — a
 *  snapshot may predate any rung, and re-implementing the ladder for restores
 *  would fork the one source of truth. Takes the already-read VALUE, never a
 *  path back into the ring: the ring's restore verb hands `apply` the parsed
 *  raw precisely so nothing downstream can race a prune by re-reading the
 *  member file. The live store is never touched: the scratch `Conf` migrates
 *  its own throwaway copy, the three domains are decoded against
 *  `PersistedStateSchema`, and any anomaly THROWS (fail-fast — a restore that
 *  proceeds from a bad snapshot is the data-loss class the ring prevents).
 *  `label` names the snapshot in the failure message. */
export function decodeStateBackup(
  raw: unknown,
  label: string,
): DecodedStateBackup {
  const scratch = mkdtempSync(join(tmpdir(), "kolu-state-backup-decode-"));
  try {
    writeFileSync(join(scratch, "config.json"), JSON.stringify(raw));
    const scratchStore = new Conf<PersistedState>({
      cwd: scratch,
      projectVersion: SCHEMA_VERSION,
      defaults: CONF_DEFAULTS,
      migrations: CONF_MIGRATIONS,
    });
    const decoded = decodePersistedState(readPersistedRecord(scratchStore));
    if (Result.isFailure(decoded)) {
      throw new Error(
        `state backup ${label} does not match the persisted schema after ` +
          `migration (${String(decoded.failure)})`,
      );
    }
    return decoded.success;
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}
