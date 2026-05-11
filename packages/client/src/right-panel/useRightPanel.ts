/** Right panel state — singleton module. Tracks collapsed, size, active tab
 *  (`"inspector" | "code"`), and the last-used code-mode (restored on
 *  Inspector→Code toggle). Persisted via server preferences under
 *  `preferences.rightPanel`. Defaults to collapsed with the Inspector tab. */

import {
  type CodeTabView,
  type RightPanelTab,
  rightPanelView,
} from "kolu-common/surface";
import { preferences, updatePreferences } from "../wire";

const MIN_PANEL_SIZE = 0.05;

export function useRightPanel() {
  const rp = () => preferences().rightPanel;

  return {
    collapsed: () => rp().collapsed,
    panelSize: () => rp().size,
    /** DU view of the active tab — `{ kind: "inspector" }` or
     *  `{ kind: "code", mode }`. Matches `match(...).with(...).exhaustive()`. */
    activeTab: (): RightPanelTab => rightPanelView(rp()),
    /** Persisted Code-tab sub-mode regardless of which tab is active.
     *  CodeTab needs the mode even when the user has flipped over to
     *  Inspector — selection / filter state is keyed by it, and the
     *  fallback behaviour of reading `activeTab` would mask a "browse"
     *  selection as "local" while Inspector is active and trigger a
     *  spurious reset on the round-trip back. */
    codeMode: (): CodeTabView => rp().codeMode,
    /** Switch to Inspector. `codeMode` is preserved so toggling back to Code
     *  restores the user's last sub-mode. */
    showInspector: () =>
      updatePreferences({ rightPanel: { activeTab: "inspector" } }),
    /** Switch to Code tab. When `mode` is omitted, the persisted `codeMode`
     *  is used — this is the round-trip case (Inspector→Code restores the
     *  last view). Pass `mode` explicitly to override. */
    showCode: (mode?: CodeTabView) =>
      updatePreferences({
        rightPanel: {
          activeTab: "code",
          ...(mode !== undefined && { codeMode: mode }),
        },
      }),
    showCodeExpanded: (mode?: CodeTabView) =>
      updatePreferences({
        rightPanel: {
          collapsed: false,
          activeTab: "code",
          ...(mode !== undefined && { codeMode: mode }),
        },
      }),
    /** Change the sub-mode within the Code tab. */
    setCodeMode: (mode: CodeTabView) =>
      updatePreferences({ rightPanel: { codeMode: mode } }),
    togglePanel: () =>
      updatePreferences({ rightPanel: { collapsed: !rp().collapsed } }),
    collapsePanel: () => updatePreferences({ rightPanel: { collapsed: true } }),
    expandPanel: () => updatePreferences({ rightPanel: { collapsed: false } }),
    setPanelSize: (size: number) => {
      if (size > MIN_PANEL_SIZE) updatePreferences({ rightPanel: { size } });
    },
  } as const;
}
