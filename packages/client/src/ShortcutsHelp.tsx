/** Modal overlay showing all keyboard shortcuts. */

import Dialog from "@corvu/dialog";
import { type Component, For } from "solid-js";
import { ACTIONS, type ActionId } from "./input/actions";
import { formatKeybind } from "./input/keyboard";
import Kbd from "./ui/Kbd";
import ModalDialog from "./ui/ModalDialog";
import { surface } from "./ui/Surface";

/** Curated display order for the shortcuts help overlay. Referencing actions
 *  by id (instead of restating label/keybind) keeps the overlay in sync with
 *  any chord reassignment in the registry. */
const HELP_ORDER: readonly { id: ActionId; label?: string }[] = [
  { id: "commandPalette" },
  { id: "openWorkspaceSwitcher" },
  { id: "createTerminal" },
  { id: "newTerminalMenu" },
  { id: "cycleTerminalMru" },
  { id: "switchTo1", label: "Switch to terminal 1–9" },
  { id: "findInTerminal" },
  { id: "copySelection" },
  { id: "zoomIn" },
  { id: "zoomOut" },
  { id: "zoomReset" },
  { id: "toggleSubPanel" },
  { id: "createSubTerminal" },
  { id: "nextSubTab" },
  { id: "prevSubTab" },
  { id: "toggleRightPanel" },
  { id: "toggleCanvasPosture" },
  { id: "shortcutsHelp" },
];

const chrome = surface({ portalled: true });

const ShortcutsHelp: Component<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
}> = (props) => (
  <ModalDialog open={props.open} onOpenChange={props.onOpenChange} size="sm">
    <Dialog.Content
      data-testid="shortcuts-help"
      class={`${chrome.class} overflow-hidden`}
      style={chrome.style}
    >
      <Dialog.Label class="block px-4 py-3 border-b border-edge text-sm font-semibold text-fg">
        Keyboard Shortcuts
      </Dialog.Label>
      <div class="px-4 py-2">
        <For each={HELP_ORDER}>
          {(entry) => {
            const action = ACTIONS[entry.id];
            return (
              <div class="flex items-center justify-between py-1.5">
                <span class="text-sm text-fg-2">
                  {entry.label ?? action.label}
                </span>
                <span class="flex items-center gap-1.5">
                  <Kbd>{formatKeybind(action.keybind)}</Kbd>
                  {action.altKeybind && (
                    <Kbd>{formatKeybind(action.altKeybind)}</Kbd>
                  )}
                </span>
              </div>
            );
          }}
        </For>
      </div>
    </Dialog.Content>
  </ModalDialog>
);

export default ShortcutsHelp;
