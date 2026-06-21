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

import { currentPtyHostIdentity as expectedKavalIdentity } from "kaval";
import { TerminalIdSchema } from "kolu-common/surface";
import { log } from "../log.ts";
import { readDaemonStatus, setAdoptedCount } from "../ptyHost/daemonStatus.ts";
import { LOCAL_HOST_ID, ptyHostClient } from "../ptyHost/index.ts";
import { reconcile } from "../reconcile.ts";
import { getSavedSession, saveSession } from "../session.ts";
import { getTerminal } from "../terminal-registry.ts";
import { restoreActiveTerminalId, snapshotSession } from "../terminals.ts";
import {
  adoptLocalOrphan,
  adoptLocalTerminal,
  reapUnrepresentablePty,
  seedSleepingTerminal,
} from "./local.ts";

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
  // its terminal is still present (adopted active OR seeded sleeping). An empty
  // registry clears the session (`saveSession` empty→null).
  restoreActiveTerminalId(
    saved?.activeTerminalId && getTerminal(saved.activeTerminalId)
      ? saved.activeTerminalId
      : null,
  );
  saveSession(snapshotSession());

  if (adoptedCount > 0) {
    setAdoptedCount(LOCAL_HOST_ID, adoptedCount);
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
  const status = readDaemonStatus(LOCAL_HOST_ID);
  const running = status?.identity?.staleKey ?? "";
  const expected = expectedKavalIdentity().staleKey;
  // By the time adoption runs the endpoint has already reported `connected` WITH
  // an identity, so a present-status-but-missing-staleKey here is an anomaly (a
  // status-propagation bug) — distinct from the benign off-nix empty, where
  // `expected` is also "". Surface it rather than let `running=""` masquerade as
  // current (which would read as "up to date" against an equally-empty expected).
  if (status && !running && expected) {
    log.warn(
      { status },
      "kaval currency: adopted daemon status has no staleKey",
    );
  }
  log.info(
    { running, expected },
    `kaval currency on adopt: running=${running} expected=${expected}`,
  );
}
