/** Global keyboard shortcuts — single capture-phase listener dispatching to handlers. */

import { type Accessor, type Setter, createEffect } from "solid-js";
import { makeEventListener } from "@solid-primitives/event-listener";
import { isPlatformModifier, matchesKeybind, SHORTCUTS } from "./keyboard";
import type { MCMode } from "./MissionControl";
import type { TerminalId, TerminalMetadata } from "kolu-common";

interface ShortcutDeps {
  terminalIds: Accessor<TerminalId[]>;
  activeId: Accessor<TerminalId | null>;
  setActiveId: Setter<TerminalId | null>;
  handleCreate: (cwd?: string) => void;
  handleCreateSubTerminal: (parentId: TerminalId, cwd?: string) => void;
  activeMeta: Accessor<TerminalMetadata | null>;
  setPaletteOpen: Setter<boolean>;
  setShortcutsHelpOpen: Setter<boolean>;
  setSearchOpen: Setter<boolean>;
  mcMode: Accessor<MCMode>;
  setMcMode: Setter<MCMode>;
  toggleSubPanel: (parentId: TerminalId) => void;
  getSubTerminalIds: (parentId: TerminalId) => TerminalId[];
  cycleSubTab: (parentId: TerminalId, direction: 1 | -1) => void;
  handleRandomizeTheme: () => void;
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
  // Mod+1-9: switch to terminal by position
  const digit = parseInt(e.key);
  if (isPlatformModifier(e) && !e.shiftKey && digit >= 1 && digit <= 9) {
    const ids = deps.terminalIds();
    if (digit <= ids.length) deps.setActiveId(ids[digit - 1]!);
    return true;
  }

  if (
    matchesKeybind(e, SHORTCUTS.createTerminalInCwd.keybind) ||
    matchesKeybind(e, SHORTCUTS.createTerminalInCwdAlt.keybind)
  ) {
    deps.handleCreate(deps.activeMeta()?.cwd ?? undefined);
    return true;
  }

  if (
    matchesKeybind(e, SHORTCUTS.createTerminal.keybind) ||
    matchesKeybind(e, SHORTCUTS.createTerminalAlt.keybind)
  ) {
    deps.handleCreate();
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
    cycleTerminal(deps, 1);
    return true;
  }

  if (matchesKeybind(e, SHORTCUTS.prevTerminal.keybind)) {
    cycleTerminal(deps, -1);
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
    if (id)
      deps.handleCreateSubTerminal(id, deps.activeMeta()?.cwd ?? undefined);
    return true;
  }

  if (matchesKeybind(e, SHORTCUTS.toggleSubPanel.keybind)) {
    const id = deps.activeId();
    if (id) {
      // If no sub-terminals exist yet, create one
      if (deps.getSubTerminalIds(id).length === 0) {
        deps.handleCreateSubTerminal(id, deps.activeMeta()?.cwd ?? undefined);
      } else {
        deps.toggleSubPanel(id);
      }
    }
    return true;
  }

  if (matchesKeybind(e, SHORTCUTS.nextSubTab.keybind)) {
    const id = deps.activeId();
    if (id) deps.cycleSubTab(id, 1);
    return true;
  }

  if (matchesKeybind(e, SHORTCUTS.prevSubTab.keybind)) {
    const id = deps.activeId();
    if (id) deps.cycleSubTab(id, -1);
    return true;
  }

  if (matchesKeybind(e, SHORTCUTS.randomizeTheme.keybind)) {
    deps.handleRandomizeTheme();
    return true;
  }

  return false;
}

function cycleTerminal(deps: ShortcutDeps, direction: 1 | -1) {
  const ids = deps.terminalIds();
  if (ids.length === 0) return;
  const current = ids.indexOf(deps.activeId() as TerminalId);
  const next = (current + direction + ids.length) % ids.length;
  deps.setActiveId(ids[next]!);
}
