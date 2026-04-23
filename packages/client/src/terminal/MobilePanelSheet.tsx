/** MobilePanelSheet — mobile burger menu for opening a tile's panels.
 *
 *  Side panels (left/right) don't render inline on mobile. The burger in
 *  the tile title bar opens this sheet, which lists actions to add or
 *  surface panel content. Tapping an action mutates the tile's `panels`
 *  via `useTerminalPanels`; the bottom slot still renders inline (so
 *  sub-terminal tabs continue to work as on the canvas), the others are
 *  best opened on a wider device for now. */

import { type Component, Show } from "solid-js";
import Drawer from "@corvu/drawer";
import type { TerminalId } from "kolu-common";
import { useTerminalPanels } from "./useTerminalPanels";

const MobilePanelSheet: Component<{
  parentId: TerminalId | null;
  onClose: () => void;
  onOpenPaletteGroup: (group: string) => void;
  onAddSubTerminalTab: (parentId: TerminalId) => void;
}> = (props) => {
  const panels = useTerminalPanels();

  function withId(fn: (id: TerminalId) => void) {
    return () => {
      const id = props.parentId;
      if (id === null) return;
      fn(id);
      props.onClose();
    };
  }

  return (
    <Drawer
      open={props.parentId !== null}
      onOpenChange={(o) => !o && props.onClose()}
    >
      <Drawer.Portal>
        <Drawer.Overlay class="fixed inset-0 z-50 bg-black/40 corvu-transitioning:transition-colors corvu-transitioning:duration-200" />
        <Drawer.Content class="fixed inset-x-0 bottom-0 z-50 max-h-[60vh] rounded-t-2xl bg-surface-1 border-t border-edge shadow-xl">
          <div class="flex justify-center pt-2 pb-1" aria-hidden="true">
            <span class="w-10 h-1 rounded-full bg-fg-3/40" />
          </div>
          <div class="px-4 py-2 text-xs uppercase tracking-wide text-fg-3/60">
            Open panel
          </div>
          <div class="flex flex-col">
            <button
              data-testid="mobile-panel-inspector"
              class="px-4 py-3 text-left text-sm text-fg hover:bg-surface-2 active:bg-surface-3 transition-colors cursor-pointer"
              onClick={withId((id) =>
                panels.openSlot(id, "right", { kind: "inspector" }),
              )}
            >
              Inspector
            </button>
            <button
              data-testid="mobile-panel-code"
              class="px-4 py-3 text-left text-sm text-fg hover:bg-surface-2 active:bg-surface-3 transition-colors cursor-pointer"
              onClick={withId((id) =>
                panels.openSlot(id, "left", { kind: "code", mode: "local" }),
              )}
            >
              Code
            </button>
            <button
              data-testid="mobile-panel-sub-terminal"
              class="px-4 py-3 text-left text-sm text-fg hover:bg-surface-2 active:bg-surface-3 transition-colors cursor-pointer"
              onClick={withId(props.onAddSubTerminalTab)}
            >
              Sub-terminal
            </button>
          </div>
          <Show when={props.parentId}>
            <div class="px-4 pt-3 pb-4 text-[11px] text-fg-3/60">
              Side panels are stacked into the bottom drawer on mobile — they
              live where the active tile can show them.
            </div>
          </Show>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer>
  );
};

export default MobilePanelSheet;
