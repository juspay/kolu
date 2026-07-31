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
 *   2. **Adopt every representable live PTY**, both kinds (never reap a
 *      survivor just because the debounced autosave lagged the daemon — F1):
 *        - survivors WITH a saved record → whole-record (`adoptLocalTerminal`),
 *          live `cwd`/`foreground` from the daemon snapshot (F2);
 *        - survivors with NO saved record (a create that never reached the
 *          debounced autosave) → live-snapshot defaults (`adoptLocalOrphan`).
 *      Either way the provider DAG re-runs against the surviving taps. The ONE
 *      survivor kolu does NOT adopt is one whose wire id is not a UUID — kolu's
 *      registry cannot represent it, so it is killed (`reapUnrepresentablePty`)
 *      rather than left running hidden; fail-closed, not fail-open.
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

import { TerminalIdSchema } from "@kolu/terminal-vocab/schema";
import { currentPtyHostIdentity as expectedKavalIdentity } from "kaval";
import { log } from "../log.ts";
import { readDaemonStatus, setAdoptedCount } from "../ptyHost/daemonStatus.ts";
import { ptyHostClient } from "../ptyHost/index.ts";
import {
  getLastPairedDaemon,
  isReplacedDaemon,
  recordPairedDaemon,
} from "../session/pairedDaemon.ts";
import { reconcile } from "../session/reconcile.ts";
import {
  clearSavedSession,
  getSavedSession,
  saveSession,
} from "../session/session.ts";
import { getTerminal } from "../terminal-registry.ts";
import { restoreActiveTerminalId, snapshotSession } from "../terminals.ts";
import { encodeHostLocation, LOCAL_LOCATION } from "../vocab.ts";
import {
  adoptLocalOrphan,
  adoptLocalTerminal,
  reapUnrepresentablePty,
  seedParkedTerminal,
  seedSleepingTerminal,
} from "./local.ts";

/** Park the saved session on the NO-SURVIVOR boot / restart path — the twin of
 *  `adoptSurvivingSession` for a FRESH (recycled) daemon, where nothing live
 *  survives. Runs when `adoptOrEnsure` did NOT adopt (a cold boot, or the
 *  supervised daemon restart's reattach step), REPLACING the old no-op that left
 *  the saved session for the client to respawn.
 *
 *  Seeds a PARKED registry entry for every saved ACTIVE record (copying its
 *  `lastActivityAt` — RISK Q6) so:
 *    - the restore card's "resume" rows are backed by live registry records the
 *      client filters OUT of the canvas tile set (a parked record never renders
 *      as a tile), keeping the canvas EMPTY so the restore card shows;
 *    - `session.restore` re-spawns each terminal by CONSUMING its parked entry
 *      (the parked→active flip is the restore idempotency token).
 *
 *  SLEEPING records are DELIBERATELY NOT seeded here (RISK Q3 — never park a
 *  sleeping record, and don't render it as a dormant tile either). Seeding a
 *  sleeping record would flip the canvas to `workspace` (a dormant tile counts as
 *  a tile) and hide the restore card — breaking the byte-identical no-survivor UX
 *  (a slept-only session must still surface the restore card after a restart, and
 *  `restoreSession` re-seeds the sleeper dormant on click). The sleeping rows on
 *  the restore card ride the saved session the client still reads; the SURVIVOR
 *  path (`adoptSurvivingSession`) DOES seed sleeping, because there it renders as
 *  a dormant tile ALONGSIDE the adopted live tiles (no restore card) — unchanged.
 *
 *  Sets the active marker (WITHOUT firing `terminals:dirty`) so a later restore's
 *  `snapshotSession` keeps the active tile; does NOT persist here — the saved
 *  session already holds the pre-reboot records the parked entries stand in for,
 *  and `snapshotSession` skips parked (a save would be a no-op at best). */
export function parkSavedSession(): void {
  const saved = getSavedSession();
  log.info(
    { saved: saved ? saved.terminals.length : null },
    `session-trace park: getSavedSession=${saved ? `${saved.terminals.length} terminals` : "null"}`,
  );
  if (!saved) {
    log.warn({}, "session-trace park: no saved session, nothing to park");
    return;
  }
  let seeded = 0;
  for (const record of saved.terminals) {
    if (record.state === "active") {
      seedParkedTerminal(record);
      seeded++;
    }
  }
  restoreActiveTerminalId(saved.activeTerminalId ?? null);
  log.info({ seeded }, `session-trace park: seeded ${seeded} parked`);
}

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

  // Is the adopted daemon OUR survivor, or a REPLACED kaval (restarted out-of-band,
  // reachable at the same socket)? `adoptOrEnsure` adopts on gate + socket +
  // handshake alone and cannot tell — so gate the converge on daemon IDENTITY. A
  // replacement's live PTYs are not our saved session's, and converging against them
  // (an empty daemon → an empty registry → `saveSession([])`'s empty→null) ERASES the
  // saved session with no restore card ever shown — the zest incident. Compare the
  // connected daemon's per-process `startedAt` against the pairing we persisted last
  // boot; `recordCurrentPairing` (onBootSettled) records THIS daemon for next time.
  const currentStartedAt = readDaemonStatus(
    encodeHostLocation(LOCAL_LOCATION),
  )?.startedAt;
  if (
    isReplacedDaemon({
      currentStartedAt,
      lastPaired: getLastPairedDaemon(),
      live,
      saved,
    })
  ) {
    // A replaced daemon is a NO-SURVIVOR boot in disguise: preserve the saved
    // session and PARK its actives for the restore card — the exact `onNotAdopted`
    // flow. Never reach the converge below (that is the erase).
    log.warn(
      { currentStartedAt },
      "boot adopted a REPLACED kaval (not our survivor) — preserving saved session, parking for restore",
    );
    parkSavedSession();
    return;
  }

  const { adopt, adoptOrphans, reapSleeping } = reconcile(live, saved);

  // Adopt every live PTY — never reap (F1). A survivor WITH a saved record rides
  // its whole record through (`adoptLocalTerminal`); a survivor with NO saved
  // record (a create that never reached the debounced autosave) is adopted from
  // the live daemon snapshot (`adoptLocalOrphan`). Killing the latter merely
  // because the debounced session lagged the daemon would break the headline
  // "terminals survive a kolu update" guarantee. `reconcile` already paired each
  // adopted record with its live PTY, so there is no join to redo here.
  for (const pair of adopt) adoptLocalTerminal(pair.record, pair.live);
  // Validate each orphan's wire id against `TerminalIdSchema` at this boundary
  // (the contract doc assigns id validation to kolu-server — ptyHostSurface.ts:36)
  // so `adoptLocalOrphan` receives a branded `TerminalId`, not a re-cast raw
  // string. A malformed (non-UUID) id is FAIL-CLOSED — the live PTY is killed
  // (`reapUnrepresentablePty`), never left running hidden (F1).
  let orphansAdopted = 0;
  for (const orphan of adoptOrphans) {
    const parsed = TerminalIdSchema.safeParse(orphan.id);
    if (!parsed.success) {
      // Fail CLOSED on an id kolu cannot represent (F1): every real client
      // mints a UUID (`crypto.randomUUID()` — kolu-server and kaval-tui alike),
      // so a non-UUID PTY is an anomaly outside kolu's domain. We cannot register
      // it (the registry is keyed on `TerminalId`), and leaving it alive would be
      // a hidden live process behind a stale restore card — exactly the fail-open
      // the boot recycle (index.ts) guards against. So KILL it rather than drop
      // and forget: kolu's domain genuinely cannot hold it, and the contract's
      // kill RPC takes the opaque wire string.
      reapUnrepresentablePty(orphan.id);
      continue;
    }
    adoptLocalOrphan(parsed.data, orphan);
    orphansAdopted += 1;
  }

  const adoptedCount = adopt.length + orphansAdopted;

  // Seed every SLEEPING saved record dormant — they have no PTY to adopt, so they
  // would otherwise be absent from the registry and wiped by the converge below.
  // Seeding here makes a slept terminal survive a server restart and ride the wire
  // as ☾ (the reboot-then-wake journey). A malformed record drops itself (tolerant).
  for (const record of saved?.terminals ?? []) {
    if (record.state === "sleeping") seedSleepingTerminal(record);
  }
  // Adopt-or-REAP the crash-window survivors: a sleep that persisted the dormant
  // record but crashed before the PTY kill completed leaves a PTY whose id is a
  // sleeping saved id. The record is sleeping, so REAP the orphan (never re-wake) —
  // the cold path converges with no orphan PTY (the reboot-mid-sleep journey).
  for (const orphan of reapSleeping) {
    log.info(
      { terminal: orphan.id },
      "reaping a sleeping terminal's crash-surviving PTY",
    );
    void ptyHostClient.surface.terminal
      .kill({ id: orphan.id })
      .catch((err) =>
        log.error({ err, terminal: orphan.id }, "reap of sleeping PTY failed"),
      );
  }

  // Converge the saved session to exactly what is now live or dormant: exited
  // terminals drop out (no stale restore card), and the active marker is kept iff
  // its terminal is still present (adopted active OR seeded sleeping).
  restoreActiveTerminalId(
    saved?.activeTerminalId && getTerminal(saved.activeTerminalId)
      ? saved.activeTerminalId
      : null,
  );
  // An empty registry here means our GENUINE survivor (identity-gated above)
  // reported all its PTYs exited during downtime — the terminals truly ended, so
  // clear, exactly `handleExit`'s behaviour (2b). Spelled as an explicit clear
  // rather than an incidental `saveSession([])` empty→null so it reads as an
  // OBSERVED all-exited on a daemon we KNOW is ours — the only boot writer allowed
  // to empty the session, and only because the replaced-daemon path returned above
  // (2c). Every other empty is a spurious transient that must never clear.
  const converged = snapshotSession();
  if (converged.terminals.length === 0) clearSavedSession();
  else saveSession(converged);

  // Record THIS daemon as our confirmed survivor — recorded only here, on the
  // survivor path (never when parking a replaced/no-survivor session onto a fresh
  // daemon), so the next boot's `startedAt` tiebreak sees the process that actually
  // held our terminals. It only decides the empty-live case (2b clear vs replaced);
  // a live-PTY id match makes the pairing moot on every other path.
  recordPairedDaemon(currentStartedAt);

  if (adoptedCount > 0) {
    setAdoptedCount(encodeHostLocation(LOCAL_LOCATION), adoptedCount);
    log.info(
      { adopted: adopt.length, orphansAdopted },
      "adopted surviving terminals after restart",
    );
  }

  // Currency diagnostic (B3.4): the adopted daemon's REPORTED build vs the kaval
  // this server WOULD spawn (its own baked `KAVAL_BUILD_ID`). When they differ
  // the survivor is a build behind — adoption (B3.3) kept a wire-compatible-but-
  // older daemon alive, so the rail's read-site `kavalStale` nudge fires ("update
  // pending") and a restart picks up the new build. Logged here — the one place
  // adoption is confirmed — as the two RAW staleKeys, so operators (and the
  // build-skew VM gate) can read "running X, would spawn Y" in the journal. The
  // nudge PREDICATE (the connected-gate + empty-guard comparison) lives in the
  // client's `kavalStale`; this is observability, not a second source of truth.
  const status = readDaemonStatus(encodeHostLocation(LOCAL_LOCATION));
  const running = status?.identity?.staleKey ?? "";
  const expected = expectedKavalIdentity().staleKey;
  // Current padi always reports an identity object for `connected`: a
  // pre-fragment kaval gets the honest-unknown `{ staleKey: "", ... }`, which is
  // expected to differ from a known baked build and drive the update nudge. Only
  // a MISSING identity object is still a status-propagation anomaly (or an older
  // padi's retained wire shape); keep that diagnostic without mislabeling the
  // intentional empty staleKey.
  if (
    status?.state === "connected" &&
    status.identity === undefined &&
    expected
  ) {
    log.error(
      { status },
      "kaval currency: adopted daemon status has no identity",
    );
  }
  log.info(
    { running, expected },
    `kaval currency on adopt: running=${running} expected=${expected}`,
  );
}
