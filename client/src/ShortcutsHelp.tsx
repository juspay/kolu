/** Modal overlay showing all keyboard shortcuts. */

import { type Component } from "solid-js";
import Dialog from "@corvu/dialog";
import ModalDialog from "./ModalDialog";
import { SHORTCUTS, formatKeybind, type Keybind } from "./keyboard";
import Kbd from "./Kbd";

interface DisplayEntry {
  label: string;
  keybind: Keybind;
  altKeybind?: Keybind;
}

/** Shortcuts to display — curated order, Mod+1-9 collapsed into one row. */
const DISPLAY_SHORTCUTS: DisplayEntry[] = [
  SHORTCUTS.commandPalette,
  {
    ...SHORTCUTS.createTerminal,
    altKeybind: SHORTCUTS.createTerminalAlt.keybind,
  },
  SHORTCUTS.cycleTerminalMru,
  { ...SHORTCUTS.switchTo1, label: "Switch to terminal 1–9" },
  SHORTCUTS.findInTerminal,
  SHORTCUTS.zoomIn,
  SHORTCUTS.zoomOut,
  SHORTCUTS.zoomReset,
  SHORTCUTS.toggleSubPanel,
  SHORTCUTS.createSubTerminal,
  SHORTCUTS.nextSubTab,
  SHORTCUTS.prevSubTab,
  SHORTCUTS.shortcutsHelp,
];

const ShortcutsHelp: Component<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
}> = (props) => (
  <ModalDialog open={props.open} onOpenChange={props.onOpenChange}>
    <Dialog.Content
      data-testid="shortcuts-help"
      class="w-full max-w-sm bg-surface-1 border border-edge rounded-2xl shadow-2xl shadow-black/50 overflow-hidden"
      style={{ "background-color": "var(--color-surface-1)" }}
    >
      <Dialog.Label class="block px-4 py-3 border-b border-edge text-sm font-semibold text-fg">
        Keyboard Shortcuts
      </Dialog.Label>
      <div class="px-4 py-2">
        {DISPLAY_SHORTCUTS.map((s) => (
          <div class="flex items-center justify-between py-1.5">
            <span class="text-sm text-fg-2">{s.label}</span>
            <span class="flex items-center gap-1.5">
              <Kbd>{formatKeybind(s.keybind)}</Kbd>
              {s.altKeybind && <Kbd>{formatKeybind(s.altKeybind)}</Kbd>}
            </span>
          </div>
        ))}
      </div>
    </Dialog.Content>
  </ModalDialog>
);

export default ShortcutsHelp;
