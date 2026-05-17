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
/** Lower bound for the Code-tab vertical split — keep the tree and content
 *  panes from collapsing to invisible via drag. Mirrors `MIN_PANEL_SIZE`'s
 *  role for the horizontal split. */
const MIN_TREE_SIZE = 0.1;
const MAX_TREE_SIZE = 0.9;

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
    /** Atomic "open the Code tab at `mode`" — uncollapse the panel,
     *  switch to Code, set the requested sub-mode. Single preferences
     *  patch so the UI ticks once instead of three times when callers
     *  need all three transitions together. Skips the patch when the
     *  panel is already in the target state (every diff→browse and
     *  browse→browse `openInCodeTab` would otherwise round-trip a
     *  three-field preferences write to the server). */
    openCodeAt: (mode: CodeTabView) => {
      const cur = rp();
      if (!cur.collapsed && cur.activeTab === "code" && cur.codeMode === mode) {
        return;
      }
      updatePreferences({
        rightPanel: {
          collapsed: false,
          activeTab: "code",
          codeMode: mode,
        },
      });
    },
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
    /** Vertical split fraction inside the Code tab — tree pane occupies
     *  this share, content pane gets the rest. Persisted across reload. */
    codeTabTreeSize: () => rp().codeTabTreeSize,
    setCodeTabTreeSize: (size: number) => {
      if (size >= MIN_TREE_SIZE && size <= MAX_TREE_SIZE) {
        updatePreferences({ rightPanel: { codeTabTreeSize: size } });
      }
    },
  } as const;
}
