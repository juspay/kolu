/** Terminal ordering — tracks top-level and sub-terminal ID lists.
 *  Hydrated from terminal.list, then mutated by lifecycle operations. */

import { type Accessor, createSignal, createMemo } from "solid-js";
import type { TerminalId } from "kolu-common";

export function useTerminalOrder() {
  const [idOrder, setIdOrder] = createSignal<TerminalId[]>([]);
  const [subOrder, setSubOrder] = createSignal<
    Record<TerminalId, TerminalId[]>
  >({});

  const terminalIds = idOrder;

  function getSubTerminalIds(parentId: TerminalId): TerminalId[] {
    return subOrder()[parentId] ?? [];
  }

  /** All terminal IDs (top-level + sub-terminals) for subscriptions. */
  const allTerminalIds = createMemo(() =>
    terminalIds().flatMap((id) => [id, ...getSubTerminalIds(id)]),
  );

  /** Human-readable label for a terminal by its sidebar position. */
  function terminalLabel(id: TerminalId): string {
    const pos = terminalIds().indexOf(id) + 1;
    return pos > 0 ? `Terminal ${pos}` : "Terminal";
  }

  return {
    idOrder,
    setIdOrder,
    subOrder,
    setSubOrder,
    terminalIds,
    getSubTerminalIds,
    allTerminalIds,
    terminalLabel,
  };
}

export type TerminalOrder = ReturnType<typeof useTerminalOrder>;
