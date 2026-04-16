/** Right panel state — singleton module. Tracks collapsed, size, and active tab,
 *  persisted via server preferences under `preferences.rightPanel`.
 *  Defaults to collapsed with the Inspector tab active. */

import type { CodeTabView, RightPanelTab } from "kolu-common";
import { useServerState } from "../settings/useServerState";

const MIN_PANEL_SIZE = 0.05;

export function useRightPanel() {
  const { preferences, updatePreferences } = useServerState();

  const rp = () => preferences().rightPanel;

  return {
    collapsed: () => rp().collapsed,
    panelSize: () => rp().size,
    activeTab: () => rp().tab,
    /** Whether the right panel is pinned (docked) vs floating overlay.
     *  Defaults to true (pinned) for backwards compat with classic mode. */
    pinned: () => rp().pinned !== false,
    codeMode: (): CodeTabView => rp().codeMode,
    setActiveTab: (tab: RightPanelTab) =>
      updatePreferences({ rightPanel: { tab } }),
    setCodeMode: (codeMode: CodeTabView) =>
      updatePreferences({ rightPanel: { codeMode } }),
    togglePanel: () =>
      updatePreferences({ rightPanel: { collapsed: !rp().collapsed } }),
    collapsePanel: () => updatePreferences({ rightPanel: { collapsed: true } }),
    expandPanel: () => updatePreferences({ rightPanel: { collapsed: false } }),
    togglePinned: () =>
      updatePreferences({ rightPanel: { pinned: rp().pinned === false } }),
    setPanelSize: (size: number) => {
      if (size > MIN_PANEL_SIZE) updatePreferences({ rightPanel: { size } });
    },
  } as const;
}
