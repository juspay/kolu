/** Dock landing is the shared terminal focus verb — no split-specific walk. */

import type { TerminalId } from "kolu-common/surface";
import { useTerminalStore } from "../../terminal/useTerminalStore";

export function useDockFocus(): (id: TerminalId) => void {
  const store = useTerminalStore();
  return (id) => store.focusTerminal(id);
}
