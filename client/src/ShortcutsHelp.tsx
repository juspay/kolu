/** Modal overlay showing all keyboard shortcuts. */

import { type Component, Show } from "solid-js";
import { makeEventListener } from "@solid-primitives/event-listener";
import { SHORTCUTS, formatKeybind } from "./keyboard";

/** Shortcuts to display — curated order, Mod+1-9 collapsed into one row. */
const DISPLAY_SHORTCUTS = [
  SHORTCUTS.commandPalette,
  SHORTCUTS.createTerminal,
  SHORTCUTS.nextTerminal,
  SHORTCUTS.prevTerminal,
  { ...SHORTCUTS.switchTo1, label: "Switch to terminal 1–9" },
  SHORTCUTS.shortcutsHelp,
];

const ShortcutsHelp: Component<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
}> = (props) => {
  let panelRef!: HTMLDivElement;

  makeEventListener(document, "mousedown", (e) => {
    if (props.open && !panelRef.contains(e.target as Node)) {
      props.onOpenChange(false);
    }
  });

  return (
    <Show when={props.open}>
      <div class="fixed inset-0 z-50 flex items-start justify-center pt-[20vh]">
        <div class="fixed inset-0 bg-black/50" />
        <div
          ref={panelRef}
          class="relative z-10 w-full max-w-sm bg-slate-800 border border-slate-600 rounded-lg shadow-2xl overflow-hidden"
        >
          <div class="px-4 py-3 border-b border-slate-600">
            <h2 class="text-sm font-semibold text-white">Keyboard Shortcuts</h2>
          </div>
          <div class="px-4 py-2">
            {DISPLAY_SHORTCUTS.map((s) => (
              <div class="flex items-center justify-between py-1.5">
                <span class="text-sm text-slate-300">{s.label}</span>
                <kbd class="px-2 py-0.5 text-xs font-mono text-slate-200 bg-slate-700 rounded border border-slate-600">
                  {formatKeybind(s.keybind)}
                </kbd>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Show>
  );
};

export default ShortcutsHelp;
