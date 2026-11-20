import type { TerminalId } from "kolu-common/surface";
import { createEffect, on } from "solid-js";
import { createStore, produce } from "solid-js/store";
import { createSharedRoot } from "../createSharedRoot";
import { useTerminalStore } from "./useTerminalStore";

function clearAll(s: Record<TerminalId, boolean>) {
  for (const id of Object.keys(s)) delete s[id as TerminalId];
}

export const useTerminalSearch = createSharedRoot(() => {
  const store = useTerminalStore();
  const [state, setState] = createStore<Record<TerminalId, boolean>>({});

  createEffect(
    on(store.activeId, () => setState(produce((s) => clearAll(s))), {
      defer: true,
    }),
  );

  return {
    isOpen(id: TerminalId): boolean {
      return state[id] ?? false;
    },
    setOpen(id: TerminalId, open: boolean) {
      setState(id, open);
    },
    openFor(id: TerminalId) {
      setState(id, true);
    },
    toggleActive() {
      const id = store.activeId();
      if (id !== null) setState(id, (v) => !v);
    },
    removeTerminal(id: TerminalId) {
      setState(produce((s) => delete s[id]));
    },
    reset() {
      setState(produce((s) => clearAll(s)));
    },
  } as const;
});
