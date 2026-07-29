/** Dock landing is the shared terminal focus verb — no split-specific walk. */

import type { TerminalId } from "kolu-common/surface";
import { toast } from "solid-sonner";
import { useTerminalStore } from "../../terminal/useTerminalStore";

export function useDockFocus(): (id: TerminalId) => void {
  const store = useTerminalStore();
  return (id) => {
    // OS notifications are durable external input and can outlive their PTY.
    // Keep the store's internal invariant loud while closing that stale edge at
    // the shared dock/notification landing boundary.
    if (!store.getMetadata(id)) {
      toast.warning("Terminal no longer exists");
      return;
    }
    store.focusTerminal(id);
  };
}
