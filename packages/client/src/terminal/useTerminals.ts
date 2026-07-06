/** Terminal session state — thin composition shell.
 *
 *  ARCHITECTURE: This file wires together focused modules:
 *    - useTerminalStore.ts    — live subscriptions + client view state
 *    - useTerminalCrud.ts     — create, kill, close-all, theme, copy
 *    - useSessionRestore.ts   — hydration, session restore
 *    - useWorktreeOps.ts      — worktree create/remove
 *    - useTerminalAlerts.ts   — Claude state detection (watches metadata subscriptions)
 *  New features should go in the appropriate module (or a new one),
 *  not back into this composition root. See #221, #242. */

import { ORPCError } from "@orpc/client";
import type { TerminalId } from "kolu-common/surface";
import { createMemo } from "solid-js";
import { toast } from "solid-sonner";
import { activeBinding } from "../binding/bindings";
import { daemonConnected } from "../kaval/useDaemonStatus";
import { isExpectedCleanupError } from "../rpc/streamCleanup";
import { terminalSubject } from "./terminalSubject";
import { useActiveReconcile } from "./useActiveReconcile";
import { useSessionRestore } from "./useSessionRestore";
import { useTerminalAlerts } from "./useTerminalAlerts";
import { useTerminalCrud } from "./useTerminalCrud";
import { useTerminalExits } from "./useTerminalExits";
import { useTerminalStore } from "./useTerminalStore";
import { useWorktreeOps } from "./useWorktreeOps";

export function useTerminals() {
  const store = useTerminalStore();

  const getSubject = (id: TerminalId) =>
    terminalSubject(store.getDisplayInfo(id), store.terminalLabel(id));

  const alerts = useTerminalAlerts({
    activeId: store.activeId,
    activate: store.activate,
    getMetadata: store.getMetadata,
    getSubject,
    hasBadgeAttention: store.hasBadgeAttention,
    clearBadgeAttention: store.clearBadgeAttention,
    markUnread: store.markUnread,
    markBadgeAttention: store.markBadgeAttention,
    terminalIds: store.terminalIds,
  });

  /** Open one terminal's exit subscription — purely to TOAST the exit code.
   *  Called from `useTerminalExits` inside the per-terminal reactive owner
   *  `mapArray` keys to the live list, so the subscription's `onCleanup` is
   *  disposed when the terminal leaves the list — no manual `createRoot`.
   *
   *  This event does NOT drive terminal-removal cleanup: the very list-removal
   *  that should trigger it disposes THIS subscription (the owner leaves the
   *  list first), so the event usually loses the race and never fires — the
   *  #1652 regression. The FULL cleanup (sub promotion, sub-panel switch/
   *  collapse, panel + MRU eviction, focus auto-switch) is therefore list-driven
   *  via `useActiveReconcile` (installed below), independent of this event. So a
   *  missed exit event costs at most the toast, never correctness — matching the
   *  socket-down `NOT_FOUND` race below (swallowed in `onError`; not retried, per
   *  shouldRetry in rpc.ts), where the terminal is still removed via the list
   *  subscription. */
  function subscribeExit(id: TerminalId) {
    // B3 — thread the ACTIVE binding (never the module-global proxy): this
    // per-terminal exit sub lives in a list-keyed `mapArray` owner, so a host
    // switch (which re-keys the terminal list) disposes this owner and its sub,
    // and the new host's terminals get fresh subs against their own binding.
    activeBinding().clients.padi.events.terminalExit.use(
      () => ({ id }),
      (code) => {
        const subject = getSubject(id);
        const headline =
          code === 0
            ? `${subject.title} exited`
            : `${subject.title} exited with code ${code}`;
        const opts = { description: subject.description };
        if (code === 0) toast(headline, opts);
        else toast.warning(headline, opts);
      },
      {
        onError: (err) => {
          // Stale-session re-subscribe to a terminal the restarted server no
          // longer has: the source throws a typed NOT_FOUND. Expected (the list
          // subscription already removed it), so swallow it rather than log a
          // scary fault. Everything else is a real error worth surfacing.
          if (err instanceof ORPCError && err.code === "NOT_FOUND") return;
          if (!isExpectedCleanupError(err)) {
            console.error("Exit stream error:", err);
          }
        },
      },
    );
  }

  const crud = useTerminalCrud();

  // Keep exactly one exit subscription per live terminal (top-level and sub),
  // keyed to the server list so kills/exits dispose it. See useTerminalExits.
  const allTerminalIds = createMemo(
    () => store.listSub()?.map((t) => t.id) ?? [],
  );
  useTerminalExits({ ids: allTerminalIds, subscribe: subscribeExit });

  // The FULL terminal-removal cleanup, driven off the LIST (not the raceable
  // `terminalExit` event): when a terminal departs the list — natural PTY exit,
  // kill, discard — its tree/chrome is reconciled (sub promotion, sub-panel
  // switch/collapse, panel + MRU eviction, focus auto-switch). Installed HERE
  // (not in useTerminalStore) because it needs BOTH the store and crud, and
  // useTerminalStore's factory can't reach crud without a require cycle. See
  // useActiveReconcile.
  useActiveReconcile({
    rawList: () => store.listSub()?.map((t) => t.id) ?? [],
    parentOf: (id) => store.getMetadata(id)?.parentId ?? null,
    evictDeparted: crud.evictDeparted,
    // Only react to a departure when the daemon is genuinely connected — during a
    // supervised recycle/restart the drain empties the list and restore undoes it,
    // so the client is not the lifecycle authority (see useActiveReconcile).
    isDaemonConnected: daemonConnected,
  });

  const session = useSessionRestore({ store });

  const worktree = useWorktreeOps({
    store,
    handleCreate: crud.handleCreate,
    handleKill: crud.handleKill,
    handleDiscard: crud.handleDiscard,
  });

  return { store, crud, session, worktree, alerts };
}
