/** Global keyboard shortcuts — single capture-phase listener dispatching to handlers. */

import { type Accessor, type Setter } from "solid-js";
import { makeEventListener } from "@solid-primitives/event-listener";
import { isPlatformModifier, matchesKeybind, SHORTCUTS } from "./keyboard";
import type { TerminalId, TerminalMetadata } from "kolu-common";

interface ShortcutDeps {
  terminalIds: Accessor<TerminalId[]>;
  activeId: Accessor<TerminalId | null>;
  setActiveId: Setter<TerminalId | null>;
  /** Terminal IDs in most-recently-used order; used for Ctrl+Tab "previous terminal". */
  mruOrder: Accessor<TerminalId[]>;
  handleCreate: (cwd?: string) => void;
  handleCreateSubTerminal: (parentId: TerminalId, cwd?: string) => void;
  openNewTerminalMenu: () => void;
  activeMeta: Accessor<TerminalMetadata | null>;
  setPaletteOpen: Setter<boolean>;
  setShortcutsHelpOpen: Setter<boolean>;
  setSearchOpen: Setter<boolean>;
  toggleMissionControl: () => void;
  toggleSubPanel: (parentId: TerminalId) => void;
  getSubTerminalIds: (parentId: TerminalId) => TerminalId[];
  cycleSubTab: (parentId: TerminalId, direction: 1 | -1) => void;
  handleRandomizeTheme: () => void;
  handleCopyTerminalText: () => void;
}

/** Wire up all global keyboard shortcuts. Call once from the app root. */
export function useShortcuts(deps: ShortcutDeps) {
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

  if (matchesKeybind(e, SHORTCUTS.newTerminalMenu.keybind)) {
    deps.openNewTerminalMenu();
    return true;
  }

  if (
    matchesKeybind(e, SHORTCUTS.createTerminal.keybind) ||
    matchesKeybind(e, SHORTCUTS.createTerminalAlt.keybind)
  ) {
    deps.handleCreate(deps.activeMeta()?.cwd ?? undefined);
    return true;
  }

  // Alt+Tab / Ctrl+Tab: jump to the previous terminal in MRU order.
  // Alt+Tab covers macOS Chrome, which intercepts Ctrl+Tab.
  if (
    (e.altKey && e.key === "Tab") ||
    matchesKeybind(e, SHORTCUTS.prevTerminalMru.keybind)
  ) {
    switchToMruPrevious(deps);
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
    deps.toggleMissionControl();
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

  if (matchesKeybind(e, SHORTCUTS.copyTerminalText.keybind)) {
    deps.handleCopyTerminalText();
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

/** Jump to the previous terminal in MRU order (one-shot, no overlay). */
function switchToMruPrevious(deps: ShortcutDeps) {
  const mru = deps.mruOrder();
  const existing = new Set(deps.terminalIds());
  const previous = mru.find((id) => existing.has(id) && id !== deps.activeId());
  if (previous) deps.setActiveId(previous);
}
