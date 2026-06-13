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
import { restart } from "@kolu/surface-daemon-supervisor";
import { log } from "../log.ts";
import { getSavedSession, setSavedSession } from "../session.ts";
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
  let adopted = 0;
  for (const { saved: s, entry } of plan.adopt) {
    if (adoptLocalTerminal(s, entry.pid) !== undefined) adopted += 1;
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
  // them); if everything was adopted, clear it. Adopted terminals re-persist
  // through normal autosave. Keep the active id only if it's still restorable.
  const { restoreCard } = plan;
  const activeStillRestorable =
    saved?.activeTerminalId != null &&
    restoreCard.some((t) => t.id === saved.activeTerminalId)
      ? saved.activeTerminalId
      : null;
  setSavedSession(
    restoreCard.length > 0
      ? {
          terminals: restoreCard,
          activeTerminalId: activeStillRestorable,
          savedAt: Date.now(),
        }
      : null,
  );

  log.info(
    {
      phase,
      daemonPtys: daemonList.length,
      adopting: plan.adopt.length,
      adopted,
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
    capture: async () => {
      const snap = snapshotSession();
      setSavedSession(
        snap.terminals.length > 0
          ? {
              terminals: snap.terminals,
              activeTerminalId: snap.activeTerminalId,
              savedAt: Date.now(),
            }
          : null,
      );
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
