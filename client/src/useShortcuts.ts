/** Global keyboard shortcuts — single capture-phase listener dispatching to handlers. */

import type { Accessor, Setter } from "solid-js";
import { makeEventListener } from "@solid-primitives/event-listener";
import { matchesKeybind, SHORTCUTS } from "./keyboard";

interface ShortcutDeps {
  terminalIds: Accessor<string[]>;
  activeId: Accessor<string | null>;
  setActiveId: Setter<string | null>;
  handleCreate: () => void;
  paletteOpen: Accessor<boolean>;
  setPaletteOpen: Setter<boolean>;
  shortcutsHelpOpen: Accessor<boolean>;
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
  // Mod+1-9: switch to terminal N
  for (let n = 1; n <= 9; n++) {
    const shortcut = SHORTCUTS[`switchTo${n}` as keyof typeof SHORTCUTS];
    if (matchesKeybind(e, shortcut.keybind)) {
      const ids = deps.terminalIds();
      if (n <= ids.length) deps.setActiveId(ids[n - 1]);
      return true;
    }
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
