/** Composes the shared `ActionContext` — the single wiring the keyboard
 *  dispatcher (`useShortcuts`) and the command palette (`createCommands`) both
 *  read. Sources every input from a singleton (store, crud, theme, sub-panel,
 *  right-panel, posture, dock, recorder) or a controller verb (command palette,
 *  shortcuts help, terminal search), so it takes NO deps — the fan-in that used
 *  to live inline in App.tsx now composes itself. */

import { toggleRailCards } from "./canvas/dock/Dock";
import { useDockOrder } from "./canvas/dock/useDockOrder";
import { useFocusTile } from "./canvas/useFocusTile";
import { showsWorkspaceSwitcher } from "./capabilities";
import type { ActionContext } from "./input/actions";
import { HOSTS_GROUP_NAME } from "./palette/hostsGroup";
import { NEW_TERMINAL_GROUP } from "./palette/newTerminalGroup";
import { TERMINALS_GROUP_NAME } from "./palette/terminalsGroup";
import { useRecorder } from "./recorder/useRecorder";
import { useRightPanel } from "./right-panel/useRightPanel";
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
  const focusTile = useFocusTile();
  const commandPalette = useCommandPalette();
  const terminalSearch = useTerminalSearch();
  const { handleShuffleTheme } = useThemeManager();
  const dockTree = useDockOrder();

  return {
    terminalIds: store.terminalIds,
    dockOrderedIds: () => dockTree().flatShortcutRows.map((r) => r.id),
    activeId: store.activeId,
    activate: store.activate,
    mruOrder: store.mruOrder,
    activeMeta: store.activeMeta,
    // Fire-and-forget create: `handleCreate` surfaces its own toasts and
    // re-throws so the awaited restore loop aborts; this void caller (keyboard /
    // palette / Dock `+`) has nothing to await, so swallow the rejection rather
    // than leak an unhandled promise rejection — a `Cmd+T` during a restart's
    // warming window would otherwise trip the e2e page-error guard.
    handleCreate: (cwd?: string) =>
      void crud.handleCreate(cwd).catch(() => {
        /* error already surfaced by handleCreate's own toast; this catch only
           absorbs the re-throw so the void caller leaks no unhandled rejection */
      }),
    handleCreateSubTerminal: (parentId, cwd) =>
      void crud.handleCreateSubTerminal(parentId, cwd),
    openNewTerminalMenu: () => commandPalette.openGroup(NEW_TERMINAL_GROUP),
    openWorkspaceSwitcher: () => {
      // ⌘⇧K → Terminals host list (type to pierce all hosts). Dock search
      // deep-links further into the active host — see App dockPalette.
      if (showsWorkspaceSwitcher())
        commandPalette.openGroup(TERMINALS_GROUP_NAME);
    },
    openHostSwitcher: () => commandPalette.openGroup(HOSTS_GROUP_NAME),
    togglePalette: commandPalette.toggle,
    toggleShortcutsHelp: shortcutsHelp.toggle,
    toggleSearch: terminalSearch.toggleActive,
    toggleSubPanel: crud.toggleSubPanel,
    cycleSubTab: (parentId, direction) =>
      subPanel.cycleSubTab(
        parentId,
        store.getSubTerminalIds(parentId),
        direction,
      ),
    handleShuffleTheme,
    handleScreenshotTerminal: () => {
      const id = store.activeId();
      if (id !== null) void screenshotTerminal(id, store.getMetadata(id));
    },
    toggleRightPanel: rightPanel.togglePanel,
    toggleDock: toggleRailCards,
    focusActiveTile: focusTile.toggle,
    // Lazy `useRecorder()` defers recorder init to the first toggle, not boot.
    toggleRecordingPause: () => useRecorder().togglePause(),
  };
}
