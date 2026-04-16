/** Global keyboard shortcuts — single capture-phase listener dispatching to handlers. */

import { type Accessor, type Setter } from "solid-js";
import { makeEventListener } from "@solid-primitives/event-listener";
import { isPlatformModifier, matchesKeybind, SHORTCUTS } from "./keyboard";
import type { TerminalId, TerminalMetadata } from "kolu-common";

interface ShortcutDeps {
  terminalIds: Accessor<TerminalId[]>;
  activeId: Accessor<TerminalId | null>;
  setActiveId: Setter<TerminalId | null>;
  /** Terminal IDs in most-recently-used order; used for Alt+Tab / Ctrl+Tab cycling. */
  mruOrder: Accessor<TerminalId[]>;
  handleCreate: (cwd?: string) => void;
  handleCreateSubTerminal: (parentId: TerminalId, cwd?: string) => void;
  openNewTerminalMenu: () => void;
  activeMeta: Accessor<TerminalMetadata | null>;
  setPaletteOpen: Setter<boolean>;
  setShortcutsHelpOpen: Setter<boolean>;
  setSearchOpen: Setter<boolean>;
  /** Toggle sub-panel: creates first split if none exist, otherwise toggles visibility. */
  toggleSubPanel: (parentId: TerminalId) => void;
  cycleSubTab: (parentId: TerminalId, direction: 1 | -1) => void;
  handleShuffleTheme: () => void;
  handleCopyTerminalText: () => void;
  handleExportSessionAsPdf: () => void;
  toggleRightPanel: () => void;
  canvasFitAll: () => void;
  canvasCenterActive: () => void;
  toggleMinimap: () => void;
}

/** MRU cycling state — a frozen snapshot is taken on the first Tab press while
 *  the modifier (Alt or Ctrl) is held, and the cursor advances through that
 *  snapshot on each subsequent Tab. Using the live MRU would re-order under
 *  our feet as setActiveId fires. Snapshot resets on modifier keyup. */
interface MruCycleState {
  snapshot: TerminalId[];
  cursor: number;
}

/** Wire up all global keyboard shortcuts. Call once from the app root. */
export function useShortcuts(deps: ShortcutDeps) {
  let cycle: MruCycleState | null = null;

  function resetCycle() {
    cycle = null;
  }

  function advanceCycle(direction: 1 | -1) {
    if (cycle === null) {
      // First press: snapshot current MRU, include active id at head if missing.
      const live = deps.mruOrder();
      const active = deps.activeId();
      const snap =
        active && !live.includes(active) ? [active, ...live] : live.slice();
      if (snap.length < 2) return; // nothing to cycle between
      cycle = { snapshot: snap, cursor: 0 };
    }
    const n = cycle.snapshot.length;
    cycle.cursor = (cycle.cursor + direction + n) % n;
    const target = cycle.snapshot[cycle.cursor];
    if (target) deps.setActiveId(target);
  }

  makeEventListener(
    window,
    "keydown",
    (e: KeyboardEvent) => {
      const handled = dispatch(e, deps, advanceCycle);
      if (handled) {
        e.preventDefault();
        e.stopPropagation();
      }
    },
    { capture: true },
  );

  // Commit the MRU cycle when the user releases the modifier key.
  makeEventListener(window, "keyup", (e: KeyboardEvent) => {
    if (e.key === "Alt" || e.key === "Control") resetCycle();
  });
}

/** Try to handle the event. Returns true if a shortcut matched. */
function dispatch(
  e: KeyboardEvent,
  deps: ShortcutDeps,
  advanceCycle: (direction: 1 | -1) => void,
): boolean {
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

  // Alt+Tab / Ctrl+Tab: cycle through terminals in MRU order, committing on
  // modifier release. Alt+Tab covers macOS Chrome, which intercepts Ctrl+Tab.
  if (e.key === "Tab" && (e.altKey || e.ctrlKey)) {
    advanceCycle(e.shiftKey ? -1 : 1);
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

  if (matchesKeybind(e, SHORTCUTS.createSubTerminal.keybind)) {
    const id = deps.activeId();
    if (id)
      deps.handleCreateSubTerminal(id, deps.activeMeta()?.cwd ?? undefined);
    return true;
  }

  if (matchesKeybind(e, SHORTCUTS.toggleSubPanel.keybind)) {
    const id = deps.activeId();
    if (id) deps.toggleSubPanel(id);
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

  if (matchesKeybind(e, SHORTCUTS.shuffleTheme.keybind)) {
    deps.handleShuffleTheme();
    return true;
  }

  if (matchesKeybind(e, SHORTCUTS.copyTerminalText.keybind)) {
    deps.handleCopyTerminalText();
    return true;
  }

  if (matchesKeybind(e, SHORTCUTS.exportSessionAsPdf.keybind)) {
    deps.handleExportSessionAsPdf();
    return true;
  }

  if (matchesKeybind(e, SHORTCUTS.toggleRightPanel.keybind)) {
    deps.toggleRightPanel();
    return true;
  }

  if (matchesKeybind(e, SHORTCUTS.canvasFitAll.keybind)) {
    deps.canvasFitAll();
    return true;
  }

  if (matchesKeybind(e, SHORTCUTS.canvasCenterActive.keybind)) {
    deps.canvasCenterActive();
    return true;
  }

  if (matchesKeybind(e, SHORTCUTS.toggleMinimap.keybind)) {
    deps.toggleMinimap();
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
