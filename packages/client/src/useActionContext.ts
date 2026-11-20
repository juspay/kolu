import { Effect } from "effect";
import { toggleRailCards } from "./canvas/dock/Dock";
import { useDockOrder } from "./canvas/dock/useDockOrder";
import { useViewPosture } from "./canvas/useViewPosture";
import { showsWorkspaceSwitcher } from "./capabilities";
import type { ActionContext } from "./input/actions";
import { toggleConductorMode } from "./conductor/useConductorMode";
import { HOSTS_GROUP_NAME } from "./palette/hostsGroup";
import { NEW_TERMINAL_GROUP } from "./palette/newTerminalGroup";
import { TERMINALS_GROUP_NAME } from "./palette/terminalsGroup";
import { useRecorder } from "./recorder/useRecorder";
import { useRightPanel } from "./right-panel/useRightPanel";
import { runAction } from "./runAction";
import { shortcutsHelp } from "./ShortcutsHelp";
import { screenshotTerminal } from "./screenshotTerminal";
import { useSubPanel } from "./terminal/useSubPanel";
import { useTerminalCrud } from "./terminal/useTerminalCrud";
import { useTerminalSearch } from "./terminal/useTerminalSearch";
import { useTerminalStore } from "./terminal/useTerminalStore";
import { useCommandPalette } from "./useCommandPalette";
import { useThemeManager } from "./useThemeManager";

export function useActionContext(): ActionContext {
  const store = useTerminalStore();
  const crud = useTerminalCrud();
  const subPanel = useSubPanel();
  const rightPanel = useRightPanel();
  const posture = useViewPosture();
  const commandPalette = useCommandPalette();
  const terminalSearch = useTerminalSearch();
  const { handleShuffleTheme } = useThemeManager();
  const dockTree = useDockOrder();

  const fireAndForget = <A, E>(
    label: string,
    action: Effect.Effect<A, E>,
  ): void => {
    runAction(label, Effect.ignore(action));
  };

  return {
    terminalIds: store.terminalIds,
    dockOrderedIds: () => dockTree().flatShortcutRows.map((r) => r.id),
    activeId: store.activeId,
    activate: store.activate,
    mruOrder: store.mruOrder,
    activeMeta: store.activeMeta,
    handleCreate: (cwd?: string) =>
      fireAndForget("create terminal", crud.handleCreate(cwd)),
    handleCreateSubTerminal: (parentId, cwd) =>
      fireAndForget(
        "create split",
        crud.handleCreateSubTerminal(parentId, cwd),
      ),
    openNewTerminalMenu: () => commandPalette.openGroup(NEW_TERMINAL_GROUP),
    openWorkspaceSwitcher: () => {
      if (showsWorkspaceSwitcher())
        commandPalette.openGroup(TERMINALS_GROUP_NAME);
    },
    openHostSwitcher: () => commandPalette.openGroup(HOSTS_GROUP_NAME),
    togglePalette: commandPalette.toggle,
    toggleShortcutsHelp: shortcutsHelp.toggle,
    toggleSearch: terminalSearch.toggleActive,
    toggleSubPanel: (parentId) =>
      runAction("toggle split", crud.toggleSubPanel(parentId)),
    cycleSubTab: (parentId, direction) =>
      subPanel.cycleSubTab(
        parentId,
        store.getSplitPaneIds(parentId),
        direction,
      ),
    handleShuffleTheme,
    handleScreenshotTerminal: () => {
      const id = store.activeId();
      if (id !== null)
        runAction(
          "screenshot terminal",
          screenshotTerminal(id, store.getMetadata(id)),
        );
    },
    toggleRightPanel: rightPanel.togglePanel,
    toggleDock: toggleRailCards,
    toggleCanvasPosture: posture.toggle,
    toggleConductor: toggleConductorMode,
    toggleRecordingPause: () => useRecorder().togglePause(),
  };
}
