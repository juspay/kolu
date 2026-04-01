/** Global keyboard shortcuts — single capture-phase listener dispatching to handlers. */

import { type Accessor, type Setter, createEffect } from "solid-js";
import { makeEventListener } from "@solid-primitives/event-listener";
import { isPlatformModifier, matchesKeybind, SHORTCUTS } from "./keyboard";
import type { MCMode } from "./MissionControl";
import type { TerminalId, TerminalMetadata } from "kolu-common";

interface ShortcutDeps {
  workspaceIds: Accessor<TerminalId[]>;
  activeId: Accessor<TerminalId | null>;
  setActiveId: Setter<TerminalId | null>;
  handleCreate: (cwd?: string) => void;
  handleCreateTerminal: (workspaceId: TerminalId, cwd?: string) => void;
  activeMeta: Accessor<TerminalMetadata | null>;
  setPaletteOpen: Setter<boolean>;
  setShortcutsHelpOpen: Setter<boolean>;
  setSearchOpen: Setter<boolean>;
  mcMode: Accessor<MCMode>;
  setMcMode: Setter<MCMode>;
  toggleTerminalPanel: (workspaceId: TerminalId) => void;
  getTerminalIds: (workspaceId: TerminalId) => TerminalId[];
  cycleTerminalTab: (workspaceId: TerminalId, direction: 1 | -1) => void;
  handleRandomizeTheme: () => void;
  handleCopyWorkspaceText: () => void;
}

/** Wire up all global keyboard shortcuts. Call once from the app root.
 *  Listener is reactively owned: only installed when MC is closed.
 *  When MC opens, SolidJS disposes the effect scope → listener removed. */
export function useShortcuts(deps: ShortcutDeps) {
  createEffect(() => {
    if (deps.mcMode().mode !== "closed") return;
    makeEventListener(
      window,
      "keydown",
      (e: KeyboardEvent) => {
        const handled = dispatch(e, deps);
        if (handled) {
          e.preventDefault();
          e.stopPropagation();
        }
      },
      { capture: true },
    );
  });
}

/** Try to handle the event. Returns true if a shortcut matched. */
function dispatch(e: KeyboardEvent, deps: ShortcutDeps): boolean {
  // Mod+1-9: switch to workspace by position
  const digit = parseInt(e.key);
  if (isPlatformModifier(e) && !e.shiftKey && digit >= 1 && digit <= 9) {
    const ids = deps.workspaceIds();
    if (digit <= ids.length) deps.setActiveId(ids[digit - 1]!);
    return true;
  }

  if (
    matchesKeybind(e, SHORTCUTS.createTerminal.keybind) ||
    matchesKeybind(e, SHORTCUTS.createTerminalAlt.keybind)
  ) {
    deps.handleCreate(deps.activeMeta()?.cwd ?? undefined);
    return true;
  }

  // Alt+Tab / Alt+Shift+Tab: quick-switch alias for macOS Chrome (which intercepts Ctrl+Tab).
  if (e.altKey && e.key === "Tab") {
    deps.setMcMode({ mode: "quickSwitch", direction: e.shiftKey ? -1 : 1 });
    return true;
  }

  // Ctrl+Tab / Ctrl+Shift+Tab: open Mission Control in quick-switch mode.
  if (matchesKeybind(e, SHORTCUTS.nextTerminalTab.keybind)) {
    deps.setMcMode({ mode: "quickSwitch", direction: 1 });
    return true;
  }

  if (matchesKeybind(e, SHORTCUTS.prevTerminalTab.keybind)) {
    deps.setMcMode({ mode: "quickSwitch", direction: -1 });
    return true;
  }

  if (matchesKeybind(e, SHORTCUTS.nextTerminal.keybind)) {
    cycleWorkspace(deps, 1);
    return true;
  }

  if (matchesKeybind(e, SHORTCUTS.prevTerminal.keybind)) {
    cycleWorkspace(deps, -1);
    return true;
  }

  if (matchesKeybind(e, SHORTCUTS.commandPalette.keybind)) {
    deps.setPaletteOpen((v) => !v);
    return true;
  }

  if (matchesKeybind(e, SHORTCUTS.shortcutsHelp.keybind)) {
    deps.setShortcutsHelpOpen((v) => !v);
    return true;
  }

  if (matchesKeybind(e, SHORTCUTS.findInTerminal.keybind)) {
    deps.setSearchOpen((v) => !v);
    return true;
  }

  if (matchesKeybind(e, SHORTCUTS.missionControl.keybind)) {
    deps.setMcMode({ mode: "browse" });
    return true;
  }

  if (matchesKeybind(e, SHORTCUTS.createSubTerminal.keybind)) {
    const id = deps.activeId();
    if (id) deps.handleCreateTerminal(id, deps.activeMeta()?.cwd ?? undefined);
    return true;
  }

  if (matchesKeybind(e, SHORTCUTS.toggleSubPanel.keybind)) {
    const id = deps.activeId();
    if (id) {
      // If no terminals exist yet, create one
      if (deps.getTerminalIds(id).length === 0) {
        deps.handleCreateTerminal(id, deps.activeMeta()?.cwd ?? undefined);
      } else {
        deps.toggleTerminalPanel(id);
      }
    }
    return true;
  }

  if (matchesKeybind(e, SHORTCUTS.nextSubTab.keybind)) {
    const id = deps.activeId();
    if (id) deps.cycleTerminalTab(id, 1);
    return true;
  }

  if (matchesKeybind(e, SHORTCUTS.prevSubTab.keybind)) {
    const id = deps.activeId();
    if (id) deps.cycleTerminalTab(id, -1);
    return true;
  }

  if (matchesKeybind(e, SHORTCUTS.randomizeTheme.keybind)) {
    deps.handleRandomizeTheme();
    return true;
  }

  if (matchesKeybind(e, SHORTCUTS.copyTerminalText.keybind)) {
    deps.handleCopyWorkspaceText();
    return true;
  }

  return false;
}

function cycleWorkspace(deps: ShortcutDeps, direction: 1 | -1) {
  const ids = deps.workspaceIds();
  if (ids.length === 0) return;
  const current = ids.indexOf(deps.activeId() as TerminalId);
  const next = (current + direction + ids.length) % ids.length;
  deps.setActiveId(ids[next]!);
}
