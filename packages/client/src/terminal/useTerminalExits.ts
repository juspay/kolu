import type { TerminalId } from "kolu-common/surface";
import { type Accessor, createEffect, mapArray } from "solid-js";

export function useTerminalExits(deps: {
  ids: Accessor<TerminalId[]>;
  subscribe: (id: TerminalId) => void;
}) {
  const reconcile = mapArray(deps.ids, (id) => {
    deps.subscribe(id);
  });
  createEffect(reconcile);
}
