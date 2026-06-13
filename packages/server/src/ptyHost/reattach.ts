/**
 * B3 survival orchestration — the soul that fills the supervisor's `RestartSteps`
 * and runs the boot reconciliation. It lives in its own module (not
 * `ptyHost/index.ts`) so it can import BOTH the endpoint (`./index.ts`) and the
 * terminal backend (`../terminalBackend/local.ts`) without the
 * `ptyHost ↔ terminalBackend` cycle that file would otherwise close.
 *
 * Two entry points, one reconciliation core:
 *  - `bootReconcile()` — after the survival boot (`adoptOrEnsure`) connects, join
 *    the daemon's live PTYs against the saved session: ADOPT survivors (a
 *    server-only redeploy kept them — process + scrollback + agent intact),
 *    restore-card the rest, reap orphans.
 *  - `restartDaemon()` — the `daemon.restart` RPC: capture the live session →
 *    drain → recycle the daemon (a fresh build) → reattach. After a recycle the
 *    daemon is empty, so reconciliation puts the whole captured session on the
 *    restore card. Serialized + `restarting`-reported by the spine.
 */

import type { PtyHostListEntry } from "kaval";
import type { SavedTerminal } from "kolu-common/surface";
import { restart } from "@kolu/surface-daemon-supervisor";
import { log } from "../log.ts";
import {
  getSavedSession,
  setPendingRestoreCard,
  setSavedSessionFromSnapshot,
} from "../session.ts";
import {
  adoptLocalTerminal,
  localTerminalBackend,
} from "../terminalBackend/local.ts";
import { snapshotSession } from "../terminals.ts";
import {
  getLocalEndpoint,
  ptyHostClient,
  resetHostInfoCache,
} from "./index.ts";
import { reconcile } from "./reconcile.ts";

/** Join the connected daemon's live PTYs against the saved session and act on the
 *  plan: adopt survivors, reap orphans, leave the non-survivors on the restore
 *  card. Emits one structured `reattach:` diagnostic. Never throws — a failed
 *  `terminal.list` logs and returns (the session stays as-is). */
async function reconcileSession(phase: "boot" | "restart"): Promise<void> {
  const saved = getSavedSession();
  let daemonList: PtyHostListEntry[];
  try {
    const res = await ptyHostClient.surface.terminal.list({});
    daemonList = res.entries;
  } catch (err) {
    log.error(
      { err, phase },
      "reattach: terminal.list failed — cannot reconcile, leaving session as-is",
    );
    return;
  }

  const plan = reconcile(daemonList, saved?.terminals ?? []);

  // Adopt survivors — live PTYs whose process, scrollback, and any agent persist.
  // A FAILED adoption (provider wiring threw → the half-wired PTY was killed, so
  // `adoptLocalTerminal` returned undefined) is NOT live and was classified as an
  // adoptee by the pure plan, so it's absent from `plan.restoreCard`. Fold it back
  // onto the restore card here, or that saved terminal would be neither live nor
  // restorable — silently lost.
  let adopted = 0;
  const failedAdopts: SavedTerminal[] = [];
  for (const { saved: s, entry } of plan.adopt) {
    if (adoptLocalTerminal(s, entry.pid) !== undefined) adopted += 1;
    else failedAdopts.push(s);
  }

  // Reap orphans — live daemon PTYs no saved session knows about (a bug-repro
  // left them, or a prior crash). Never silently kept (they hold fds + RAM).
  for (const orphan of plan.orphanExtras) {
    void ptyHostClient.surface.terminal
      .kill({ id: orphan.id })
      .catch((err) =>
        log.error({ err, terminal: orphan.id }, "reattach: orphan reap failed"),
      );
  }

  // The non-survivors stay on the restore card (the saved session trimmed to just
  // them) plus any adoption that failed above; if everything was adopted, clear
  // it. Adopted terminals re-persist through normal autosave. Keep the active id
  // only if it's still restorable.
  const restoreCard = [...plan.restoreCard, ...failedAdopts];
  const activeStillRestorable =
    saved?.activeTerminalId != null &&
    restoreCard.some((t) => t.id === saved.activeTerminalId)
      ? saved.activeTerminalId
      : null;
  setSavedSessionFromSnapshot({
    terminals: restoreCard,
    activeTerminalId: activeStillRestorable,
  });

  // PARTIAL reconcile — some survivors adopted (live, on screen) AND some saved
  // terminals left on the restore card. The restore card is only presented from
  // the EMPTY-canvas state (`store.terminalIds().length === 0`), so with adopted
  // survivors on screen the user can't SEE it until they close those — but it
  // must not be LOST in the meantime. The survivors' own `terminals:dirty`
  // events arm an autosave that re-snapshots only the live terminals, which would
  // overwrite the saved session and delete the restore-card remainder. Register
  // that remainder as the pending restore card (AFTER the write above, which
  // clears any prior pending set) so the autosave loop unions it back into every
  // snapshot — the terminals stay durable on disk until the user closes the
  // survivors and the empty-canvas restore card offers the whole set.
  //
  // This fail-closed guard is only exercised on the BOOT-ADOPT path of a real
  // server-only redeploy that kept SOME but not all PTYs (CI can't redeploy over
  // a live daemon; the restart-from-degraded path always recycles to a FRESH
  // empty daemon, so every terminal lands on an empty-canvas restore card, never
  // a partial one). The non-empty-canvas restore affordance that lets the user
  // act on the remainder WITHOUT closing the survivors is the R-2 follow-up;
  // until then the data is preserved, just not yet directly clickable.
  if (adopted > 0 && restoreCard.length > 0) {
    setPendingRestoreCard(restoreCard);
    log.warn(
      {
        phase,
        adopted,
        onRestoreCard: restoreCard.map((t) => t.id),
      },
      "reattach: PARTIAL reconcile — restore-card terminals are held in the " +
        "pending restore set (durable across autosave) but not surfaced while " +
        "survivors occupy the canvas; the user sees them after closing the " +
        "survivors (R-2: non-empty-canvas restore affordance). Only reachable on " +
        "a partial-survivor redeploy (staged-prod gate).",
    );
  } else {
    // Non-partial reconcile (everything adopted, or everything on the card from a
    // fresh recycle): no remainder to protect. Clear any stale pending set from a
    // prior partial reconcile so it can't leak into a later autosave union.
    setPendingRestoreCard([]);
  }

  log.info(
    {
      phase,
      daemonPtys: daemonList.length,
      adopting: plan.adopt.length,
      adopted,
      adoptFailed: failedAdopts.length,
      fromSaved: saved?.terminals.length ?? 0,
      orphanedSaved: restoreCard.length,
      extras: plan.orphanExtras.length,
    },
    "reattach: reconciled session against daemon survivors",
  );
}

/** After the survival boot connects, reconcile the saved session against the
 *  daemon's survivors. No-op if the boot left no connection (dead/degraded). */
export async function bootReconcile(): Promise<void> {
  if (!getLocalEndpoint()?.current()) return;
  await reconcileSession("boot");
}

/** The supervised `daemon.restart` RPC: capture the live session, drain it,
 *  recycle the daemon to the current build, and reattach. Throws if no endpoint
 *  exists or the recycle leaves no connection (the endpoint already reported the
 *  failure state). Serialized + `restarting`-reported by the spine's `restart`. */
export async function restartDaemon(): Promise<void> {
  const ep = getLocalEndpoint();
  if (!ep) throw new Error("daemon.restart: no local endpoint");
  await restart(ep, {
    // Capture the live session BEFORE the old daemon dies, persisting it so the
    // post-recycle restore card (and a later cold restore) can offer it. Wins the
    // autosave-cancel race by construction (`setSavedSession` cancels any pending
    // dirty-driven autosave).
    //
    // ONLY overwrite when the live snapshot has terminals. A restart fired from a
    // `dead` boot (kaval never came up → registry empty) or a `degraded` window
    // that already lost its registry would snapshot `[]`; persisting that nulls the
    // saved session and deletes the very restore data the degraded/dead UI promises
    // to preserve. An empty live session is "nothing new to capture", not "drop
    // what's saved" — so leave the existing saved session in place.
    capture: async () => {
      const snapshot = snapshotSession();
      if (snapshot.terminals.length > 0) {
        setSavedSessionFromSnapshot(snapshot);
      }
    },
    // Drain the live terminals — the single kill path aborts each exit tap before
    // killing, so the daemon death during the recycle can't double-publish exits.
    drain: async () => {
      await localTerminalBackend.killAllTerminals();
    },
    // Reattach against the FRESH daemon: re-read host facts, then reconcile. After
    // a recycle the daemon is empty, so every captured terminal falls to the
    // restore card (a survivor-adopting redeploy goes through the boot path).
    reattach: async () => {
      resetHostInfoCache();
      await reconcileSession("restart");
    },
  });
}
