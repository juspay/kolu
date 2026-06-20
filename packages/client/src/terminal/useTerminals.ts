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
import { isExpectedCleanupError } from "../rpc/streamCleanup";
import { app } from "../wire";
import { terminalSubject } from "./terminalSubject";
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

  /** Open one terminal's exit subscription (one-shot action, not queryable
   *  state). Called from `useTerminalExits` inside the per-terminal reactive
   *  owner `mapArray` keys to the live list, so the subscription's `onCleanup`
   *  is disposed when the terminal leaves the list — no manual `createRoot`.
   *
   *  Race: if the terminal exits while the socket is down, the retried
   *  re-subscribe throws a typed `NOT_FOUND` `ORPCError` (swallowed in
   *  `onError` below; not retried, per shouldRetry in rpc.ts) and the exit
   *  toast is missed. The terminal itself is still removed via the list
   *  subscription in useTerminalStore, so correctness is preserved even if
   *  the toast is lost. */
  function subscribeExit(id: TerminalId) {
    app.events.terminalExit.use(
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
        crud.removeAndAutoSwitch(id);
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

  // Singleton (reads `useTerminalStore`/`useTerminalCrud` internally), so it no
  // longer takes a DI bag — and `TileTitleActions`/`DormantTileBody` can call
  // `useSessionRestore().handleWake(id)` directly instead of an App-drilled prop.
  const session = useSessionRestore();

  const worktree = useWorktreeOps({
    store,
    handleCreate: crud.handleCreate,
    handleKill: crud.handleKill,
    handleDiscardSleeping: session.handleDiscardSleeping,
  });

  return { store, crud, session, worktree, alerts };
}
