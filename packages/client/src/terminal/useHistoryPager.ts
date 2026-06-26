/** Per-terminal copy-mode history-pager visibility — singleton via
 *  `createSharedRoot`, a near-clone of {@link useTerminalSearch}. The pager is a
 *  read-only surface over the on-disk transcript (PR2); open-state is keyed by
 *  `TerminalId` because the title-bar button targets a specific tile.
 *
 *  Behavior contract (mirrors the find bar): the pager closes when the active
 *  terminal changes — an `on(store.activeId)` effect clears every key on switch,
 *  so at most the active terminal's pager is open. Keys are evicted on terminal
 *  removal and wholesale on kill-all. */

import type { TerminalId } from "kolu-common/surface";
import { createEffect, on } from "solid-js";
import { createStore, produce } from "solid-js/store";
import { createSharedRoot } from "../createSharedRoot";
import { useTerminalStore } from "./useTerminalStore";

function clearAll(s: Record<TerminalId, boolean>) {
  for (const id of Object.keys(s)) delete s[id as TerminalId];
}

export const useHistoryPager = createSharedRoot(() => {
  const store = useTerminalStore();
  const [state, setState] = createStore<Record<TerminalId, boolean>>({});

  // Close the pager when the active terminal changes (deferred so boot doesn't
  // clobber a pager opened before the first switch).
  createEffect(
    on(store.activeId, () => setState(produce((s) => clearAll(s))), {
      defer: true,
    }),
  );

  return {
    /** Is the pager open for terminal `id`? */
    isOpen(id: TerminalId): boolean {
      return state[id] ?? false;
    },
    /** Open the pager for terminal `id`. */
    openFor(id: TerminalId) {
      setState(id, true);
    },
    /** Close the pager for terminal `id`. */
    closeFor(id: TerminalId) {
      setState(id, false);
    },
    /** Toggle the pager for the active terminal — the `Mod+Shift+H` action. */
    toggleActive() {
      const id = store.activeId();
      if (id !== null) setState(id, (v) => !v);
    },
    /** Drop a terminal's pager state when it's removed. */
    removeTerminal(id: TerminalId) {
      setState(produce((s) => delete s[id]));
    },
    /** Clear every pager — called by kill-all. */
    reset() {
      setState(produce((s) => clearAll(s)));
    },
  } as const;
});
