/** Sidebar open/close state — singleton module. Syncs with sm breakpoint. */

import { createSignal } from "solid-js";
import { makeEventListener } from "@solid-primitives/event-listener";

const SM_QUERY = window.matchMedia("(min-width: 640px)");
const [sidebarOpen, setSidebarOpen] = createSignal(SM_QUERY.matches);

// Auto-close on mobile, auto-open on desktop when viewport crosses sm breakpoint
makeEventListener(SM_QUERY, "change", (e: MediaQueryListEvent) =>
  setSidebarOpen(e.matches),
);

export function useSidebar() {
  return {
    sidebarOpen,
    toggleSidebar: () => setSidebarOpen((prev) => !prev),
    closeSidebar: () => setSidebarOpen(false),
  } as const;
}
