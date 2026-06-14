/** Per-terminal find-bar visibility — singleton via `createSharedRoot` (the
 *  same primitive the other domain singletons use, so the verb object is built
 *  once and the `useTerminalStore` dependency is captured in the shared root
 *  rather than re-read per call). The xterm search overlay is scoped to one
 *  terminal at a time; open-state is keyed by `TerminalId` because `Terminal`
 *  reads `searchOpen` per id and `openFor(id)` targets a specific tile.
 *
 *  Behavior contract (preserved from the pre-refactor App, where a single
 *  `searchOpen` signal was reset by `on(activeId)`): the find bar closes when
 *  the active terminal changes — switching away and back does NOT resurrect a
 *  previously-open bar. The keyed store alone would persist per-terminal state
 *  and reopen on return, so an explicit `on(store.activeId)` effect clears every
 *  key on switch, keeping at most the active terminal's bar open. Sub-terminals
 *  never open search (their leaf always passes `searchOpen={false}`). Keys are
 *  evicted in `removeAndAutoSwitch` (single remove) and wholesale via `reset()`
 *  from `handleCloseAll` (kill-all), so the map can't grow past the live
 *  terminal set or outlive the terminals it keyed. */

import type { TerminalId } from "kolu-common/surface";
import { createEffect, on } from "solid-js";
import { createStore, produce } from "solid-js/store";
import { createSharedRoot } from "../createSharedRoot";
import { useTerminalStore } from "./useTerminalStore";

/** Drop every key from the open-state record in place (used by the
 *  active-terminal-switch reset and `reset()`). */
function clearAll(s: Record<TerminalId, boolean>) {
  for (const id of Object.keys(s)) delete s[id as TerminalId];
}

export const useTerminalSearch = createSharedRoot(() => {
  const store = useTerminalStore();
  const [state, setState] = createStore<Record<TerminalId, boolean>>({});

  // Close every find bar when the active terminal changes. Deferred so the
  // initial run (boot) doesn't clobber a bar opened before the first switch.
  // This reproduces the old App-level `on(activeId, () => setSearchOpen(false))`
  // exactly: the bar is a per-session affordance on the focused terminal, not a
  // sticky per-terminal preference that reappears on return.
  createEffect(
    on(store.activeId, () => setState(produce((s) => clearAll(s))), {
      defer: true,
    }),
  );

  return {
    /** Is the find bar open for terminal `id`? */
    isOpen(id: TerminalId): boolean {
      return state[id] ?? false;
    },
    /** Open or close the find bar for terminal `id`. */
    setOpen(id: TerminalId, open: boolean) {
      setState(id, open);
    },
    /** Open the find bar for terminal `id` — the "find in THIS terminal" intent
     *  named once, so the tile's find button doesn't hand-roll `setOpen(id,
     *  true)`. The search singleton owns find-bar state; tile selection stays
     *  with the caller (TileTitleActions' `onTile`). */
    openFor(id: TerminalId) {
      setState(id, true);
    },
    /** Toggle the find bar for the active terminal — the `Cmd+F` action. */
    toggleActive() {
      const id = store.activeId();
      if (id !== null) setState(id, (v) => !v);
    },
    /** Drop a terminal's find-bar state when it's removed. */
    removeTerminal(id: TerminalId) {
      setState(produce((s) => delete s[id]));
    },
    /** Clear every find bar — called by `handleCloseAll` after `killAll`, which
     *  resets the store wholesale instead of routing each terminal through
     *  `removeAndAutoSwitch`, so the per-terminal eviction never runs. */
    reset() {
      setState(produce((s) => clearAll(s)));
    },
  } as const;
});
