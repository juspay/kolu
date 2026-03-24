/** Modal overlay showing all keyboard shortcuts. */

import { type Component } from "solid-js";
import { makeEventListener } from "@solid-primitives/event-listener";
import { SHORTCUTS, formatKeybind } from "./keyboard";
import Overlay from "./Overlay";

/** Shortcuts to display — curated order, Mod+1-9 collapsed into one row. */
const DISPLAY_SHORTCUTS = [
  SHORTCUTS.commandPalette,
  SHORTCUTS.createTerminal,
  SHORTCUTS.nextTerminal,
  SHORTCUTS.prevTerminal,
  { ...SHORTCUTS.switchTo1, label: "Switch to terminal 1–9" },
  SHORTCUTS.findInTerminal,
  SHORTCUTS.shortcutsHelp,
];

const ShortcutsHelp: Component<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
}> = (props) => {
  // Close on Escape
  makeEventListener(
    window,
    "keydown",
    (e: KeyboardEvent) => {
      if (props.open && e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        props.onOpenChange(false);
      }
    },
    { capture: true },
  );

  return (
    <Overlay open={props.open} onClose={() => props.onOpenChange(false)}>
      <div
        data-testid="shortcuts-help"
        class="w-full max-w-sm bg-surface-1 border border-edge-bright rounded-lg shadow-2xl overflow-hidden"
      >
        <div class="px-4 py-3 border-b border-edge-bright">
          <h2 class="text-sm font-semibold text-fg">Keyboard Shortcuts</h2>
        </div>
        <div class="px-4 py-2">
          {DISPLAY_SHORTCUTS.map((s) => (
            <div class="flex items-center justify-between py-1.5">
              <span class="text-sm text-fg-2">{s.label}</span>
              <kbd class="px-2 py-0.5 text-[0.65rem] font-mono text-fg-2 bg-surface-2 rounded border border-edge shadow-[inset_0_-1px_0_rgba(0,0,0,0.3)]">
                {formatKeybind(s.keybind)}
              </kbd>
            </div>
          ))}
        </div>
      </div>
    </Overlay>
  );
};

export default ShortcutsHelp;
