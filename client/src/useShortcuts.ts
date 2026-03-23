/** Global keyboard shortcuts — single capture-phase listener dispatching to handlers. */

import type { Accessor, Setter } from "solid-js";
import { makeEventListener } from "@solid-primitives/event-listener";
import { isPlatformModifier, matchesKeybind, SHORTCUTS } from "./keyboard";

interface ShortcutDeps {
  terminalIds: Accessor<string[]>;
  activeId: Accessor<string | null>;
  setActiveId: Setter<string | null>;
  handleCreate: () => void;
  handleCreateInCwd: () => void;
  setPaletteOpen: Setter<boolean>;
  setShortcutsHelpOpen: Setter<boolean>;
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
    if (digit <= ids.length) deps.setActiveId(ids[digit - 1]);
    return true;
  }

  if (matchesKeybind(e, SHORTCUTS.createTerminalInCwd.keybind)) {
    deps.handleCreateInCwd();
    return true;
  }

  if (matchesKeybind(e, SHORTCUTS.createTerminal.keybind)) {
    deps.handleCreate();
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

  return false;
}

function cycleTerminal(deps: ShortcutDeps, direction: 1 | -1) {
  const ids = deps.terminalIds();
  if (ids.length === 0) return;
  const current = ids.indexOf(deps.activeId() ?? "");
  const next = (current + direction + ids.length) % ids.length;
  deps.setActiveId(ids[next]);
}
