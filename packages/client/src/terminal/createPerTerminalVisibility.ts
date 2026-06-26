/** Per-terminal toggleable-overlay visibility — the volatile axis the find bar
 *  ({@link useTerminalSearch}) and the copy-mode history pager
 *  ({@link useHistoryPager}) both encapsulate: open-state keyed by `TerminalId`,
 *  with at most the active terminal's overlay open (it closes on an
 *  active-terminal switch).
 *
 *  This is a plain factory, NOT a `createSharedRoot`: each consumer wraps it in
 *  its own shared root, so the store + `on(activeId)` clear effect + verbs are a
 *  fresh, isolated singleton per overlay (the find bar and the pager never share
 *  one open-state map). The close-on-switch policy lives here once, so a change
 *  to it can't drift between the two overlays. */

import type { TerminalId } from "kolu-common/surface";
import { createEffect, on } from "solid-js";
import { createStore, produce } from "solid-js/store";
import { useTerminalStore } from "./useTerminalStore";

/** Drop every key from the open-state record in place (used by the
 *  active-terminal-switch reset and `reset()`). */
function clearAll(s: Record<TerminalId, boolean>) {
  for (const id of Object.keys(s)) delete s[id as TerminalId];
}

export function createPerTerminalVisibility() {
  const store = useTerminalStore();
  const [state, setState] = createStore<Record<TerminalId, boolean>>({});

  // Close every overlay when the active terminal changes. Deferred so the
  // initial run (boot) doesn't clobber an overlay opened before the first
  // switch. The overlay is a per-session affordance on the focused terminal, not
  // a sticky per-terminal preference that reappears on return.
  createEffect(
    on(store.activeId, () => setState(produce((s) => clearAll(s))), {
      defer: true,
    }),
  );

  return {
    /** Is the overlay open for terminal `id`? */
    isOpen(id: TerminalId): boolean {
      return state[id] ?? false;
    },
    /** Open or close the overlay for terminal `id`. */
    setOpen(id: TerminalId, open: boolean) {
      setState(id, open);
    },
    /** Open the overlay for terminal `id` — the "in THIS terminal" intent named
     *  once, so a tile button doesn't hand-roll `setOpen(id, true)`. */
    openFor(id: TerminalId) {
      setState(id, true);
    },
    /** Toggle the overlay for the active terminal — the keyboard action. */
    toggleActive() {
      const id = store.activeId();
      if (id !== null) setState(id, (v) => !v);
    },
    /** Drop a terminal's overlay state when it's removed. */
    removeTerminal(id: TerminalId) {
      setState(produce((s) => delete s[id]));
    },
    /** Clear every overlay — called by kill-all, which resets the store
     *  wholesale instead of routing each terminal through a single remove. */
    reset() {
      setState(produce((s) => clearAll(s)));
    },
  } as const;
}
