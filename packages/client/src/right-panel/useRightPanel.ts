/** Right panel state — singleton module. Tracks collapsed, size, pin, and
 *  active tab (a discriminated union of Inspector vs Code-with-mode),
 *  persisted via server preferences under `preferences.rightPanel`.
 *  Defaults to collapsed with the Inspector tab active. */

import type { CodeTabView, RightPanelTab } from "kolu-common";
import { usePreferences } from "../settings/usePreferences";

const MIN_PANEL_SIZE = 0.05;

export function useRightPanel() {
  const { preferences, updatePreferences } = usePreferences();

  const rp = () => preferences().rightPanel;

  return {
    collapsed: () => rp().collapsed,
    panelSize: () => rp().size,
    /** The full tab state — discriminated union of Inspector vs Code+mode. */
    activeTab: (): RightPanelTab => rp().tab,
    /** Switch to Inspector. */
    showInspector: () =>
      updatePreferences({ rightPanel: { tab: { kind: "inspector" } } }),
    /** Switch to Code tab with the given mode (defaults to "local").
     *  Code-mode memory is intentionally not preserved across Inspector↔Code
     *  switches — simpler state, no "what was I last looking at?" field. */
    showCode: (mode: CodeTabView = "local") =>
      updatePreferences({ rightPanel: { tab: { kind: "code", mode } } }),
    /** Change the sub-mode within the Code tab. */
    setCodeMode: (mode: CodeTabView) =>
      updatePreferences({ rightPanel: { tab: { kind: "code", mode } } }),
    togglePanel: () =>
      updatePreferences({ rightPanel: { collapsed: !rp().collapsed } }),
    collapsePanel: () => updatePreferences({ rightPanel: { collapsed: true } }),
    expandPanel: () => updatePreferences({ rightPanel: { collapsed: false } }),
    setPanelSize: (size: number) => {
      if (size > MIN_PANEL_SIZE) updatePreferences({ rightPanel: { size } });
    },
  } as const;
}
