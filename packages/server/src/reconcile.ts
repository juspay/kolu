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
 *     are ADOPTED too — seeded from the live daemon snapshot (`orphanMeta`) — NOT
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
import type { SavedSession, SavedTerminal } from "kolu-common/surface";

export interface ReconcileResult {
  /** Saved terminals whose PTY is still alive — adopt each whole-record. */
  adopt: SavedTerminal[];
  /** Live daemon PTYs with no saved record — adopt from the live snapshot
   *  (`orphanMeta`), never reap. See the module doc (F1). */
  adoptOrphans: PtyHostListEntry[];
}

/** Join a surviving daemon's live PTYs against the saved session on terminal
 *  `id`. A saved terminal that is not live is an exited shell — dropped (in
 *  neither returned list). See the module doc for the full partition. */
export function reconcile(
  live: PtyHostListEntry[],
  saved: SavedSession | null,
): ReconcileResult {
  const liveIds = new Set(live.map((entry) => entry.id));
  const savedTerminals = saved?.terminals ?? [];
  const savedIds = new Set(savedTerminals.map((terminal) => terminal.id));
  return {
    adopt: savedTerminals.filter((terminal) => liveIds.has(terminal.id)),
    adoptOrphans: live.filter((entry) => !savedIds.has(entry.id)),
  };
}
