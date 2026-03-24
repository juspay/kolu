/** Modal overlay showing all keyboard shortcuts. Uses Corvu Dialog for focus trapping and accessibility. */

import { type Component } from "solid-js";
import Dialog from "@corvu/dialog";
import { SHORTCUTS, formatKeybind } from "./keyboard";

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

/** Refocus the active terminal after a dialog closes. */
function refocusTerminal() {
  document
    .querySelector<HTMLElement>("[data-visible][data-terminal-id]")
    ?.click();
}

const ShortcutsHelp: Component<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
}> = (props) => {
  return (
    <Dialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      restoreFocus={false}
      onFinalFocus={(e) => {
        e.preventDefault();
        refocusTerminal();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay class="fixed inset-0 z-50 bg-black/50" />
        <div class="fixed inset-0 z-50 flex items-start justify-center pt-[15vh] pointer-events-none">
          <Dialog.Content
            data-testid="shortcuts-help"
            class="pointer-events-auto w-full max-w-sm bg-surface-1 border border-edge-bright rounded-lg shadow-2xl overflow-hidden"
          >
            <Dialog.Label class="block px-4 py-3 border-b border-edge-bright text-sm font-semibold text-fg">
              Keyboard Shortcuts
            </Dialog.Label>
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
          </Dialog.Content>
        </div>
      </Dialog.Portal>
    </Dialog>
  );
};

export default ShortcutsHelp;
