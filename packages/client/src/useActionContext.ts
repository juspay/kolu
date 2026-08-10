/** Composes the shared `ActionContext` — the single wiring the keyboard
 *  dispatcher (`useShortcuts`) and the command palette (`createCommands`) both
 *  read. Sources every input from a singleton (store, crud, theme, sub-panel,
 *  right-panel, posture, dock, recorder) or a controller verb (command palette,
 *  shortcuts help, terminal search), so it takes NO deps — the fan-in that used
 *  to live inline in App.tsx now composes itself. */

import { Effect } from "effect";
import { toggleRailCards } from "./canvas/dock/Dock";
import { useDockOrder } from "./canvas/dock/useDockOrder";
import { useViewPosture } from "./canvas/useViewPosture";
import { showsWorkspaceSwitcher } from "./capabilities";
import { useHostRecency } from "./host/hostRecency";
import type { ActionContext } from "./input/actions";
import { HOSTS_GROUP_NAME } from "./palette/hostsGroup";
import { NEW_TERMINAL_GROUP } from "./palette/newTerminalGroup";
import { TERMINALS_GROUP_NAME } from "./palette/terminalsGroup";
import { useRecorder } from "./recorder/useRecorder";
import { runAction } from "./runAction";
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
  const posture = useViewPosture();
  const commandPalette = useCommandPalette();
  const terminalSearch = useTerminalSearch();
  const { handleShuffleTheme } = useThemeManager();
  const dockTree = useDockOrder();
  // The host switch trail behind `openHostSwitcher`'s default highlight. Born
  // HERE — the one fan-in every session mounts — rather than lazily on the
  // palette's first read of a host row, so the trail records from boot and the
  // very first ⌘⇧H already knows where the user came from.
  useHostRecency();

  return {
    terminalIds: store.terminalIds,
    dockOrderedIds: () => dockTree().flatShortcutRows.map((r) => r.id),
    activeId: store.activeId,
    activate: store.activate,
    mruOrder: store.mruOrder,
    activeMeta: store.activeMeta,
    // Fire-and-forget create: `handleCreate` surfaces its own toasts and FAILS
    // so the composing restore loop aborts; this edge (keyboard / palette /
    // Dock `+`) has nothing waiting on the id, so it `Effect.ignore`s the
    // refusal — a `Cmd+T` during a restart's warming window is an ordinary
    // no-op here, not an error to report twice.
    handleCreate: (cwd?: string) =>
      runAction("create terminal", crud.handleCreate(cwd).pipe(Effect.ignore)),
    handleCreateSubTerminal: (parentId, cwd) =>
      runAction(
        "create split",
        crud.handleCreateSubTerminal(parentId, cwd).pipe(Effect.ignore),
      ),
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
    toggleSubPanel: (parentId) =>
      runAction("toggle split", crud.toggleSubPanel(parentId)),
    cycleSubTab: (parentId, direction) =>
      subPanel.cycleSubTab(
        parentId,
        // Flat tab strip — Cmd-cycle walks every descendant of the tile, not
        // just one-hop children (matches the canvas split tabs).
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
    // Lazy `useRecorder()` defers recorder init to the first toggle, not boot.
    toggleRecordingPause: () => useRecorder().togglePause(),
  };
}
