/** Terminal session state — thin composition shell.
 *
 *  ARCHITECTURE: This file wires together focused modules:
 *    - useTerminalStore.ts    — live subscriptions + client view state
 *    - useTerminalCrud.ts     — create, kill, close-all, theme, copy
 *    - useSessionRestore.ts   — hydration, session restore
 *    - useWorktreeOps.ts      — worktree create/remove
 *  (Agent-attention alerts moved out to the ONE cross-host owner,
 *  `attention/useAttention.ts`, wired in `App.tsx`.)
 *  New features should go in the appropriate module (or a new one),
 *  not back into this composition root. See #221, #242. */

import { ORPCError } from "@orpc/client";
import { encodeHostKey } from "kolu-common/hostKey";
import type { TerminalId } from "kolu-common/surface";
import { createMemo } from "solid-js";
import { toast } from "solid-sonner";
import { activeScope } from "../hostScope/hostScopes";
import { listIsAuthoritative } from "../kaval/useDaemonStatus";
import { isExpectedCleanupError } from "../rpc/streamCleanup";
import { activeHost, padiMap } from "../wire";
import { terminalSubject } from "./terminalSubject";
import { useActiveReconcile } from "./useActiveReconcile";
import { useAdoptNewSplit } from "./useAdoptNewSplit";
import { useSessionRestore } from "./useSessionRestore";
import { useSubPanel } from "./useSubPanel";
import { useTerminalCrud } from "./useTerminalCrud";
import { useTerminalExits } from "./useTerminalExits";
import { useTerminalStore } from "./useTerminalStore";
import { useWorktreeOps } from "./useWorktreeOps";

export function useTerminals() {
  const store = useTerminalStore();

  const getSubject = (id: TerminalId) =>
    terminalSubject(
      store.getDisplayInfo(id),
      store.getMetadata(id),
      store.terminalLabel(id),
    );

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
    padiMap.useEntry(activeHost).events.terminalExit.use(
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
  // `allTerminalIds` is the ONE memoized projection of the list ids — also fed to
  // the reconcile + adopt hooks below (not re-mapped per hook). `parentOf` is the
  // ONE live parentId reader both hooks share, and `activeHostKey` the ONE
  // host-scope key both host-scope their snapshot on.
  const allTerminalIds = createMemo(
    () => store.listSub()?.map((t) => t.id) ?? [],
  );
  const parentOf = (id: TerminalId) => store.getMetadata(id)?.parentId ?? null;
  const activeHostKey = () => encodeHostKey(activeHost());
  useTerminalExits({ ids: allTerminalIds, subscribe: subscribeExit });

  // The FULL terminal-removal cleanup, driven off the LIST (not the raceable
  // `terminalExit` event): when a terminal departs the list — natural PTY exit,
  // kill, discard — its tree/chrome is reconciled (sub promotion, sub-panel
  // switch/collapse, panel + MRU eviction, focus auto-switch). Installed HERE
  // (not in useTerminalStore) because it needs BOTH the store and crud, and
  // useTerminalStore's factory can't reach crud without a require cycle. See
  // useActiveReconcile.
  useActiveReconcile({
    rawList: allTerminalIds,
    parentOf,
    // Host-scope the reconcile: a switch replaces the whole list, and the baseline
    // must reset rather than evict the departed host's tiles (no wrong-host writes).
    activeHostKey,
    evictDeparted: crud.evictDeparted,
    // Only react to a departure when the terminal list is AUTHORITATIVE (a
    // complete census) — during a supervised recycle/restart the drain empties the
    // list and restore undoes it, so a departure isn't a user close and the client
    // is not the lifecycle authority (see useActiveReconcile). The ONE named
    // census fact `useDeepLinks`'s gone-verdict also gates on (#1900).
    listIsAuthoritative,
  });

  // Make an EXTERNALLY-created split (padi-tui `create --parent`, another client)
  // behave like a manual one: expand the parent's panel and — unless a live split
  // is already active — select the new tab. Reacts to the arrival on the list, so
  // no actor has to reach into the browser's sub-panel state. Host-scoped and
  // gated on the restore seed so it never fights hydration. See useAdoptNewSplit.
  //
  // Installed BEFORE useSessionRestore so adopt observes the pre-seed phase on the
  // seed-boundary flush. On the flush where the last terminal's metadata arrives,
  // hydration flips the restore latch to `seeded` (a plain non-reactive write) and
  // seeds each panel in the SAME batch; an adopt run that sampled the just-flipped
  // `seeded` for a sub first entering the snapshot on that flush would false-adopt
  // it (re-opening a restored-collapsed panel, persisting the wrong state). Adopt
  // runs first for TWO independent reasons: it is created first (creation order),
  // AND its effect is memo-backed (`on(snapshot)`) while hydration is a plain
  // effect — SolidJS schedules a memo-backed effect ahead of a plain one. So it
  // samples the pre-flip `decided`, baselines the sub, and skips; hydration then
  // owns the seed. (Verified against the installed runtime in useAdoptNewSplit.test.)
  const subPanel = useSubPanel();
  useAdoptNewSplit({
    rawList: allTerminalIds,
    parentOf,
    activeHostKey,
    restorePhase: () => activeScope()?.restore.phase ?? "pending",
    ports: {
      expandPanel: subPanel.expandPanel,
      activeSubTab: (parentId) => subPanel.peekSubPanel(parentId).activeSubTab,
      setActiveSubTab: subPanel.setActiveSubTab,
    },
  });

  const session = useSessionRestore({ store });

  const worktree = useWorktreeOps({
    store,
    handleCreate: crud.handleCreate,
    handleKill: crud.handleKill,
    handleDiscard: crud.handleDiscard,
  });

  return { store, crud, session, worktree, getSubject };
}
