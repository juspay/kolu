/**
 * Boot-time adoption (B3.3) — kolu's soul side of "terminals survive a deploy".
 *
 * When `ensureLocalEndpoint` ADOPTS a surviving kaval daemon (a redeploy that did
 * not change kaval's source — `adoptOrEnsure` returned `true`), the daemon's PTYs
 * are still alive. This orchestrates the reconciliation that the spine cannot
 * (the endpoint adopts a *connection*; kolu reconciles its *contents*):
 *
 *   1. List the surviving daemon's live PTYs and `reconcile` them against the
 *      saved session.
 *   2. **Reap** orphan PTYs (live, but no saved record) — never respawn, so
 *      #1275's duplicate-terminals bug stays impossible.
 *   3. **Adopt** each survivor whole-record (`adoptTerminal`), re-running its
 *      provider DAG against the surviving taps.
 *   4. **Converge** the saved session to exactly the adopted set: exited shells
 *      (saved but no longer live) drop out so no stale restore card lingers, and
 *      the active marker is preserved iff its terminal survived. An all-exited
 *      survivor clears the session (no restore card for shells that genuinely
 *      ended — exactly `handleExit`'s behavior).
 *   5. **Surface the count** so the client shows its one-shot "N reattached"
 *      confirmation.
 *
 * Runs ONLY for a daemon that survived. A fresh / recycled boot has no survivors,
 * so the existing restore-card path (the client reads the saved session and
 * offers to re-spawn it) is left untouched — B2 behavior, unchanged.
 */

import type { PtyHostListEntry } from "kaval";
import { log } from "../log.ts";
import { setAdoptedCount } from "../ptyHost/daemonStatus.ts";
import { LOCAL_HOST_ID, ptyHostClient } from "../ptyHost/index.ts";
import { reconcile } from "../reconcile.ts";
import { getSavedSession, saveSession } from "../session.ts";
import { restoreActiveTerminalId, snapshotSession } from "../terminals.ts";
import { adoptLocalTerminal } from "./local.ts";

/** Reconcile a SURVIVING kaval daemon's live PTYs against the saved session and
 *  adopt the survivors. See the module doc. Called from `ensureLocalEndpoint`
 *  only when the boot adopted a surviving daemon. */
export async function adoptSurvivingSession(): Promise<void> {
  let live: PtyHostListEntry[];
  try {
    live = (await ptyHostClient.surface.terminal.list({})).entries;
  } catch (err) {
    log.error(
      { err },
      "could not list the surviving daemon's terminals — skipping adoption",
    );
    return;
  }

  const saved = getSavedSession();
  const { adopt, orphanExtras } = reconcile(live, saved);

  // Reap live PTYs with no saved record (a create that never autosaved, a
  // leftover from a crashed prior server). Reaping — never respawning — is what
  // keeps #1275's duplicate-terminals bug impossible.
  for (const orphan of orphanExtras) {
    log.warn(
      { id: orphan.id, pid: orphan.pid },
      "reaping orphan PTY (no saved record) after restart",
    );
    try {
      await ptyHostClient.surface.terminal.kill({ id: orphan.id });
    } catch (err) {
      log.error({ id: orphan.id, err }, "orphan PTY reap failed");
    }
  }

  // Adopt each survivor with its WHOLE saved record.
  const liveById = new Map(live.map((entry) => [entry.id, entry]));
  for (const record of adopt) {
    const liveEntry = liveById.get(record.id);
    if (liveEntry) adoptLocalTerminal(record, liveEntry);
  }

  // Converge the saved session to exactly what is now live: exited terminals
  // drop out (no stale restore card for them), and the active marker is kept
  // iff its terminal survived. An empty adopted set clears the session
  // (`saveSession` empty→null), so an all-exited survivor shows no restore card.
  restoreActiveTerminalId(
    saved?.activeTerminalId &&
      adopt.some((r) => r.id === saved.activeTerminalId)
      ? saved.activeTerminalId
      : null,
  );
  saveSession(snapshotSession());

  if (adopt.length > 0) {
    setAdoptedCount(LOCAL_HOST_ID, adopt.length);
    log.info(
      { adopted: adopt.length, reaped: orphanExtras.length },
      "adopted surviving terminals after restart",
    );
  }
}
