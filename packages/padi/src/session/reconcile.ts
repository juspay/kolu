/**
 * Boot-time session reconciliation (B3.3) — the pure partition that decides what
 * a SURVIVING kaval daemon's live PTYs mean against kolu's saved session.
 *
 * When a kolu-server redeploy did NOT change kaval's source, the daemon outlives
 * the restart with its PTYs intact (`adoptOrEnsure` adopts the connection rather
 * than recycling it). This function joins the daemon's `terminal.list()` against
 * the saved session on the stable terminal `id` (the same UUID `createTerminal`
 * minted and persisted), and partitions:
 *
 *   - **adopt** — saved terminals whose PTY is still alive. Carried as the WHOLE
 *     `SavedTerminal` record (never field-by-field — the #1275 lossy-adoption
 *     class that dropped `parentId` and `lastAgentCommand`), to be re-wired by
 *     `adoptTerminal`.
 *   - **adoptOrphans** — live daemon PTYs with NO saved record (F1): a create
 *     that never reached the 500ms-debounced autosave before the restart (the
 *     common redeploy window), or a leftover from a crashed prior server. These
 *     are ADOPTED too — seeded from the live daemon snapshot (`orphanSnapshot`) — NOT
 *     reaped: killing a live shell merely because the debounced session lagged
 *     behind the daemon would violate the headline "terminals survive a kolu
 *     update" guarantee. They never carry a saved id, so re-adopting (rather than
 *     re-spawning) them keeps #1275's duplicate-terminals bug impossible by
 *     construction.
 *
 * A saved terminal with no live PTY is an **exited shell** — its process ended in
 * the restart window — so it appears in NEITHER list: the caller drops it exactly
 * as `handleExit` drops a shell that exits while the server is up. (Re-spawning a
 * saved session onto a FRESH daemon — the restore card — is the no-survivor path,
 * which never reaches here: `adoptOrEnsure` reports it did not adopt, so the
 * caller leaves the saved session for the existing card. `reconcile` runs only
 * for a daemon that survived.)
 *
 * Pure (no IO, no daemon, no registry) so the partition — and the #1275 class it
 * forecloses — is unit-testable against synthetic inputs.
 */

import type { PtyHostListEntry } from "kaval";
import type {
  SavedActiveTerminal,
  SavedSession,
  SavedSleepingTerminal,
} from "../vocab.ts";

/** A saved terminal whose PTY is still alive, paired with that live PTY. The
 *  join lives here (not the caller), so adoption never re-derives it: the
 *  `record` rides through whole (#1275: a unit, never field-by-field) and the
 *  `live` entry is the authority for the non-replayed fields cwd/foreground (F2). */
export interface AdoptPair {
  record: SavedActiveTerminal;
  live: PtyHostListEntry;
}

/** One step of {@link ReconcileResult.plan}, in SAVED ORDER.
 *
 *  Order is the point. The registry is a `Map` and its insertion order IS the
 *  client's row order (`terminal-registry.ts:registerTerminal`), so the sequence
 *  a rebuild path calls in decides where every dock row sits — and, since #2141
 *  made dock order structural, which terminal each `Cmd+1..9` reaches. The
 *  caller used to receive an unordered partition, index `adopt` back into a
 *  `Map`, and re-walk `saved.terminals` itself to interleave the sleepers; that
 *  is this module's join and this module's ordering, re-derived one file over,
 *  where nothing said it mattered. Handing over the ordered plan makes the walk
 *  a dispatch. */
export type ReconcileStep =
  | { kind: "adopt"; record: SavedActiveTerminal; live: PtyHostListEntry }
  | { kind: "seedSleeping"; record: SavedSleepingTerminal };

export interface ReconcileResult {
  /** What to do with each saved record that survives, IN SAVED ORDER — adopt an
   *  active whose PTY lived, seed a sleeping one dormant. A saved terminal with
   *  no live PTY is an exited shell and is simply absent, exactly as before.
   *  True orphans are NOT here: they have no saved position, and the caller
   *  appends them after (they are the newest things on the host). */
  plan: ReconcileStep[];
  /** Live daemon PTYs with no saved record — adopt from the live snapshot
   *  (`orphanSnapshot`), never reap. See the module doc (F1). */
  adoptOrphans: PtyHostListEntry[];
  /** Live daemon PTYs whose id matches a SLEEPING saved record — a sleep that
   *  persisted the dormant record but crashed before the PTY kill completed, so
   *  the PTY briefly outlived the flip. Adopt-or-REAP resolves to REAP: the
   *  record is sleeping, so the caller kills the orphaned PTY and keeps the record
   *  dormant (the boot never re-wakes a sleeping terminal). Without this, the PTY
   *  would fall into neither adopt nor adoptOrphans (its id is a saved id) and
   *  leak as a hidden live process. */
  reapSleeping: PtyHostListEntry[];
}

/** Join a surviving daemon's live PTYs against the saved session on terminal
 *  `id`. A saved terminal that is not live is an exited shell — dropped (in
 *  neither returned list). See the module doc for the full partition. */
export function reconcile(
  live: readonly PtyHostListEntry[],
  saved: SavedSession | null,
): ReconcileResult {
  const liveById = new Map(live.map((entry) => [entry.id, entry]));
  const savedTerminals = saved?.terminals ?? [];
  const savedIds = new Set(savedTerminals.map((terminal) => terminal.id));
  const sleepingIds = new Set(
    savedTerminals
      .filter((terminal) => terminal.state === "sleeping")
      .map((terminal) => terminal.id),
  );
  const plan: ReconcileStep[] = [];
  for (const record of savedTerminals) {
    // A SLEEPING record released its PTY at sleep, so it is seeded dormant and
    // never paired with a live entry — but it holds a POSITION, which is why it
    // belongs in this walk rather than in a second pass afterwards. Seeding
    // every sleeper after every adopted active is what used to move each ☾ tile
    // to the tail of its repo section on a padi restart.
    if (record.state === "sleeping") {
      plan.push({ kind: "seedSleeping", record });
      continue;
    }
    // Only an ACTIVE saved terminal can be ADOPTED. The narrow also makes
    // `record` the active arm for the whole-record adopt.
    if (record.state !== "active") continue;
    const liveEntry = liveById.get(record.id);
    if (liveEntry) plan.push({ kind: "adopt", record, live: liveEntry });
  }
  return {
    plan,
    adoptOrphans: live.filter((entry) => !savedIds.has(entry.id)),
    // A sleeping record's id is a saved id, so its surviving PTY is excluded from
    // adoptOrphans above; surface it here so the caller reaps it.
    reapSleeping: live.filter((entry) => sleepingIds.has(entry.id)),
  };
}
