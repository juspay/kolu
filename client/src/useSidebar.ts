/** Sidebar open/close + width state — singleton module. Syncs with sm breakpoint. */

import { createSignal } from "solid-js";
import { makePersisted } from "@solid-primitives/storage";
import { makeEventListener } from "@solid-primitives/event-listener";

const SM_QUERY = window.matchMedia("(min-width: 640px)");
const [sidebarOpen, setSidebarOpen] = createSignal(SM_QUERY.matches);
const [isDesktop, setIsDesktop] = createSignal(SM_QUERY.matches);

/** Sidebar panel size as a fraction (0–1). Default ~11rem / typical viewport. */
const DEFAULT_SIZE = 0.15;
const [sidebarSize, setSidebarSize] = makePersisted(
  createSignal(DEFAULT_SIZE),
  { name: "kolu-sidebar-size" },
);

// Auto-close on mobile, auto-open on desktop when viewport crosses sm breakpoint
makeEventListener(SM_QUERY, "change", (e: MediaQueryListEvent) => {
  setSidebarOpen(e.matches);
  setIsDesktop(e.matches);
});

export function useSidebar() {
  return {
    sidebarOpen,
    toggleSidebar: () => setSidebarOpen((prev) => !prev),
    closeSidebar: () => setSidebarOpen(false),
    sidebarSize,
    setSidebarSize,
    isDesktop,
  } as const;
}
