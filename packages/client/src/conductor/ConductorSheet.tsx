/** The conductor on a touch layout: a full-screen sheet.
 *
 *  The conversation is chat and nothing else on every form factor, so below the
 *  breakpoint there is no layout left to reduce: the mode is not a layout at
 *  all — it is the conversation, over everything, dismissed the way every other
 *  touch sheet in kolu is. The pane inside is the SAME component the desktop
 *  mounts, so a phone gets the whole conversation rather than a cut-down one.
 *
 *  Mode is the same per-tab `sessionStorage` selection the desktop reads
 *  (`useConductorMode`), so the sheet is open exactly when the conductor
 *  is the selected chrome-bar entry in THIS tab — including when the chord was
 *  pressed on a hardware keyboard attached to a tablet. */

import Drawer from "@corvu/drawer";
import { type Component, Show } from "solid-js";
import { withKeyboardDismiss } from "../ui/dismissSoftKeyboard";
import ConductorPane from "./ConductorPane";
import { exitConductorMode, conductorMode } from "./useConductorMode";

/** Corvu @0.2.4 defaults `snapPoints` to `[0, 1]` but reads the signal before
 *  the default attaches on the click-open path (#977); passing it explicitly
 *  sidesteps the reactive-ordering bug. The same workaround `MobileTileView`
 *  carries — delete both on the Corvu upgrade that fixes it. */
const CORVU_SNAP_WORKAROUND: [number, number] = [0, 1];

const ConductorSheet: Component = () => {
  const close = withKeyboardDismiss((open: boolean) => {
    if (!open) exitConductorMode();
  });

  return (
    <Show when={conductorMode()}>
      <Drawer
        side="bottom"
        open
        onOpenChange={close}
        snapPoints={CORVU_SNAP_WORKAROUND}
        // The composer owns focus inside the sheet; letting Corvu restore it to
        // the trigger on dismiss re-summons the soft keyboard over the canvas.
        restoreFocus={false}
      >
        <Drawer.Portal>
          <Drawer.Overlay
            data-testid="conductor-sheet-backdrop"
            class="fixed inset-0 z-40 bg-black/40 opacity-0 transition-opacity duration-200 data-open:opacity-100"
          />
          <Drawer.Content
            data-testid="conductor-sheet"
            class="fixed inset-x-0 bottom-0 top-8 z-50 rounded-t-2xl overflow-hidden border-t border-edge bg-surface-0"
          >
            {/* `relative`: the pane carries no positioning of its own, and its
             *  drop overlay anchors to it. */}
            <ConductorPane class="relative h-full" />
          </Drawer.Content>
        </Drawer.Portal>
      </Drawer>
    </Show>
  );
};

export default ConductorSheet;
