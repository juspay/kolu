import type { TerminalId } from "kolu-common/surface";
import { toast } from "solid-sonner";
import { useTerminalStore } from "../../terminal/useTerminalStore";

export function useDockFocus(): (id: TerminalId) => void {
  const store = useTerminalStore();
  return function focusTerminalIfLive(id) {
    if (!store.getMetadata(id)) {
      toast.warning("Terminal no longer exists");
      return;
    }
    store.focusTerminal(id);
  };
}
