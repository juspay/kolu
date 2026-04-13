/** Right panel state — singleton module. Tracks collapsed and size, persisted across sessions.
 *  Open by default on desktop (sm breakpoint), collapsed on mobile. */

import { createSignal } from "solid-js";
import { makePersisted } from "@solid-primitives/storage";
import { makeEventListener } from "@solid-primitives/event-listener";

const SM_QUERY = window.matchMedia("(min-width: 640px)");
const DEFAULT_PANEL_SIZE = 0.25;

const [collapsed, setCollapsed] = makePersisted(
  createSignal(!SM_QUERY.matches),
  { name: "kolu-right-panel-collapsed" },
);

const [panelSize, setPanelSize] = makePersisted(
  createSignal(DEFAULT_PANEL_SIZE),
  { name: "kolu-right-panel-size" },
);

// Auto-collapse on mobile, auto-expand on desktop when viewport crosses sm breakpoint
makeEventListener(SM_QUERY, "change", (e: MediaQueryListEvent) =>
  setCollapsed(!e.matches),
);

export function useRightPanel() {
  return {
    collapsed,
    panelSize,
    togglePanel: () => setCollapsed((prev) => !prev),
    collapsePanel: () => setCollapsed(true),
    expandPanel: () => setCollapsed(false),
    setPanelSize: (size: number) => {
      if (size > 0.05) setPanelSize(size);
    },
  } as const;
}
