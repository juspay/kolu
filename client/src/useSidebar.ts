/** Sidebar open/close + width state — singleton module. Syncs with sm breakpoint. */

import { createSignal } from "solid-js";
import { makePersisted } from "@solid-primitives/storage";
import { makeEventListener } from "@solid-primitives/event-listener";

const SM_QUERY = window.matchMedia("(min-width: 640px)");
const [sidebarOpen, setSidebarOpen] = createSignal(SM_QUERY.matches);
const [isDesktop, setIsDesktop] = createSignal(SM_QUERY.matches);

/** Sidebar width in pixels. Only changes via user drag. */
const DEFAULT_WIDTH_PX = 192;
const [sidebarWidthPx, setSidebarWidthPx] = makePersisted(
  createSignal(DEFAULT_WIDTH_PX),
  { name: "kolu-sidebar-width-px" },
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
    sidebarWidthPx,
    setSidebarWidthPx,
    isDesktop,
  } as const;
}
