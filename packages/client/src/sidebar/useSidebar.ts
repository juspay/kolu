/** Sidebar open/close state — singleton module. Syncs with sm breakpoint. */

import { createSignal, createEffect, on } from "solid-js";
import { isMobile } from "../useMobile";

const [sidebarOpen, setSidebarOpen] = createSignal(!isMobile());

// Auto-close on mobile, auto-open on desktop when viewport crosses sm breakpoint
createEffect(on(isMobile, (mobile) => setSidebarOpen(!mobile)));

export function useSidebar() {
  return {
    sidebarOpen,
    toggleSidebar: () => setSidebarOpen((prev) => !prev),
    closeSidebar: () => setSidebarOpen(false),
  } as const;
}
