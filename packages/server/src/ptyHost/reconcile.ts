/**
 * Reconcile a daemon's live PTYs against the saved session — the pure decision
 * at the heart of B3 survival. A boot (or a supervised restart's reattach) asks:
 * of the terminals I had, which survived in the daemon (adopt them, no respawn),
 * which didn't (offer them on the restore card), and which live PTYs does the
 * daemon hold that I no longer know about (orphans — reap them)?
 *
 * Pure and total: a `Map`/`Set` join on terminal id, no I/O, no throw. The caller
 * acts on the plan (adopt, restore-card, kill). Keeping the decision here makes it
 * unit-testable without a daemon and keeps `reattach.ts` to orchestration.
 */

import type { PtyHostListEntry } from "kaval";
import type { SavedTerminal } from "kolu-common/surface";

export interface ReconcilePlan {
  /** Saved terminals whose PTY survived in the daemon — adopt the live pid,
   *  no respawn (the process, scrollback, and any running agent persist). */
  adopt: Array<{ saved: SavedTerminal; entry: PtyHostListEntry }>;
  /** Saved terminals with no surviving PTY — offer them on the restore card
   *  (never silently dropped). */
  restoreCard: SavedTerminal[];
  /** Live daemon PTYs not in the saved session — orphans to reap + log (a
   *  bug-repro left them, or a prior crash). */
  orphanExtras: PtyHostListEntry[];
}

/** Join the daemon's `terminal.list` against the saved session by id. */
export function reconcile(
  daemonList: PtyHostListEntry[],
  saved: SavedTerminal[],
): ReconcilePlan {
  const liveById = new Map(daemonList.map((e) => [e.id, e]));
  const savedIds = new Set(saved.map((s) => s.id));

  const adopt: ReconcilePlan["adopt"] = [];
  const restoreCard: SavedTerminal[] = [];
  for (const s of saved) {
    const entry = liveById.get(s.id);
    if (entry) adopt.push({ saved: s, entry });
    else restoreCard.push(s);
  }
  const orphanExtras = daemonList.filter((e) => !savedIds.has(e.id));

  return { adopt, restoreCard, orphanExtras };
}
