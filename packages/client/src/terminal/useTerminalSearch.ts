/** Per-terminal find-bar visibility — singleton module. The xterm search
 *  overlay is scoped to one terminal at a time; keying open-state by
 *  `TerminalId` means switching terminals reads a different key (closed by
 *  default), so the bar closes on switch structurally — no `on(activeId)`
 *  reset effect to keep in sync. Sub-terminals never open search (their leaf
 *  always passes `searchOpen={false}`). Keys are evicted in
 *  `removeAndAutoSwitch` so the map can't grow past the live terminal set. */

import type { TerminalId } from "kolu-common/surface";
import { createStore, produce } from "solid-js/store";
import { useTerminalStore } from "./useTerminalStore";

const [state, setState] = createStore<Record<TerminalId, boolean>>({});

export function useTerminalSearch() {
  const store = useTerminalStore();
  return {
    /** Is the find bar open for terminal `id`? */
    isOpen(id: TerminalId): boolean {
      return state[id] ?? false;
    },
    /** Open or close the find bar for terminal `id`. */
    setOpen(id: TerminalId, open: boolean) {
      setState(id, open);
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
  } as const;
}
