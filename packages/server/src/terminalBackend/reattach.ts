/**
 * Boot-time adoption (B3.3) — kolu's soul side of "terminals survive a deploy".
 *
 * When `ensureLocalEndpoint` ADOPTS a surviving kaval daemon (a redeploy that did
 * not change kaval's source — `adoptOrEnsure` returned `true`), the daemon's PTYs
 * are still alive. This orchestrates the reconciliation that the spine cannot
 * (the endpoint adopts a *connection*; kolu reconciles its *contents*):
 *
 *   1. List the surviving daemon's live PTYs and `reconcile` them against the
 *      saved session. A failure to list is a FAILED adoption, not a quiet skip
 *      (F3): it throws, and the boot recycles the daemon so it never leaves a
 *      connected survivor holding PTYs kolu has no registry entry for.
 *   2. **Adopt every live PTY**, both kinds (never reap — F1):
 *        - survivors WITH a saved record → whole-record (`adoptLocalTerminal`),
 *          live `cwd`/`foreground` from the daemon snapshot (F2);
 *        - survivors with NO saved record (a create that never reached the
 *          debounced autosave) → live-snapshot defaults (`adoptLocalOrphan`).
 *      Either way the provider DAG re-runs against the surviving taps.
 *   3. **Converge** the saved session to exactly the adopted set: exited shells
 *      (saved but no longer live) drop out so no stale restore card lingers, and
 *      the active marker is preserved iff its terminal survived. An all-exited
 *      survivor clears the session (no restore card for shells that genuinely
 *      ended — exactly `handleExit`'s behavior).
 *   4. **Surface the count** so the client shows its one-shot "N reattached"
 *      confirmation.
 *
 * Runs ONLY for a daemon that survived. A fresh / recycled boot has no survivors,
 * so the existing restore-card path (the client reads the saved session and
 * offers to re-spawn it) is left untouched — B2 behavior, unchanged.
 */

import { log } from "../log.ts";
import { setAdoptedCount } from "../ptyHost/daemonStatus.ts";
import { LOCAL_HOST_ID, ptyHostClient } from "../ptyHost/index.ts";
import { reconcile } from "../reconcile.ts";
import { getSavedSession, saveSession } from "../session.ts";
import { restoreActiveTerminalId, snapshotSession } from "../terminals.ts";
import { adoptLocalOrphan, adoptLocalTerminal } from "./local.ts";

/** Reconcile a SURVIVING kaval daemon's live PTYs against the saved session and
 *  adopt the survivors. See the module doc. Called from `ensureLocalEndpoint`
 *  only when the boot adopted a surviving daemon.
 *
 *  THROWS if it cannot list the survivor's PTYs (F3): a connected daemon holding
 *  PTYs kolu has no registry entry for is a fail-closed condition — the boot
 *  recycles it rather than leaving hidden live PTYs behind a stale restore card.
 *  Every per-terminal adoption failure is contained (it reaps just that PTY), so
 *  the only throw is the all-or-nothing `list`. */
export async function adoptSurvivingSession(): Promise<void> {
  // Fail CLOSED on a list failure (F3): re-throw so the boot recycles the
  // survivor. Returning here would leave the endpoint connected to a daemon
  // whose PTYs kolu never registered — invisible live terminals behind a stale
  // restore card, and a duplicate-terminal hazard if the user restored it.
  const live = (await ptyHostClient.surface.terminal.list({})).entries;

  const saved = getSavedSession();
  const { adopt, adoptOrphans } = reconcile(live, saved);

  // Adopt every live PTY — never reap (F1). A survivor WITH a saved record rides
  // its whole record through (`adoptLocalTerminal`); a survivor with NO saved
  // record (a create that never reached the debounced autosave) is adopted from
  // the live daemon snapshot (`adoptLocalOrphan`). Killing the latter merely
  // because the debounced session lagged the daemon would break the headline
  // "terminals survive a kolu update" guarantee. `reconcile` already paired each
  // adopted record with its live PTY, so there is no join to redo here.
  for (const pair of adopt) adoptLocalTerminal(pair.record, pair.live);
  for (const orphan of adoptOrphans) adoptLocalOrphan(orphan);

  const adoptedCount = adopt.length + adoptOrphans.length;

  // Converge the saved session to exactly what is now live: exited terminals
  // drop out (no stale restore card for them), and the active marker is kept
  // iff its terminal survived. An empty adopted set clears the session
  // (`saveSession` empty→null), so an all-exited survivor shows no restore card.
  restoreActiveTerminalId(
    saved?.activeTerminalId &&
      adopt.some(({ record }) => record.id === saved.activeTerminalId)
      ? saved.activeTerminalId
      : null,
  );
  saveSession(snapshotSession());

  if (adoptedCount > 0) {
    setAdoptedCount(LOCAL_HOST_ID, adoptedCount);
    log.info(
      { adopted: adopt.length, orphansAdopted: adoptOrphans.length },
      "adopted surviving terminals after restart",
    );
  }
}
