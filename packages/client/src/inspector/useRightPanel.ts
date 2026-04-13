/** Right panel state — singleton module. Tracks collapsed and size, persisted via server preferences.
 *  Defaults to collapsed. User's explicit choice sticks regardless of viewport. */

import { useServerState } from "../settings/useServerState";

const MIN_PANEL_SIZE = 0.05;

export function useRightPanel() {
  const { preferences, updatePreferences } = useServerState();

  return {
    collapsed: () => preferences().rightPanelCollapsed,
    panelSize: () => preferences().rightPanelSize,
    togglePanel: () =>
      updatePreferences({
        rightPanelCollapsed: !preferences().rightPanelCollapsed,
      }),
    collapsePanel: () => updatePreferences({ rightPanelCollapsed: true }),
    expandPanel: () => updatePreferences({ rightPanelCollapsed: false }),
    setPanelSize: (size: number) => {
      if (size > MIN_PANEL_SIZE) updatePreferences({ rightPanelSize: size });
    },
  } as const;
}
