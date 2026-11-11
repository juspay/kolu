/** The orchestrator on a touch layout: a full-screen sheet.
 *
 *  Below the breakpoint there is no canvas to peek into and no room for three
 *  columns, so the mode is not a layout at all — it is the conversation, over
 *  everything, dismissed the way every other touch sheet in kolu is. The pane
 *  inside is the SAME component the desktop mounts: a phone gets the whole
 *  conversation, not a reduction of it. What it does not get is the peek pane,
 *  because the thing a peek shows (a live terminal beside the chat) is a
 *  two-column idea.
 *
 *  Mode is the same device-global signal the desktop reads, so the sheet is
 *  open exactly when orchestrator mode is on — including when the chord was
 *  pressed on a hardware keyboard attached to a tablet. */

import Drawer from "@corvu/drawer";
import { type Component, Show } from "solid-js";
import { withKeyboardDismiss } from "../ui/dismissSoftKeyboard";
import OrchestratorPane from "./OrchestratorPane";
import { exitOrchestratorMode, orchestratorMode } from "./useOrchestratorMode";

/** Corvu @0.2.4 defaults `snapPoints` to `[0, 1]` but reads the signal before
 *  the default attaches on the click-open path (#977); passing it explicitly
 *  sidesteps the reactive-ordering bug. The same workaround `MobileTileView`
 *  carries — delete both on the Corvu upgrade that fixes it. */
const CORVU_SNAP_WORKAROUND: [number, number] = [0, 1];

const OrchestratorSheet: Component = () => {
  const close = withKeyboardDismiss((open: boolean) => {
    if (!open) exitOrchestratorMode();
  });

  return (
    <Show when={orchestratorMode()}>
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
            data-testid="orchestrator-sheet-backdrop"
            class="fixed inset-0 z-40 bg-black/40 opacity-0 transition-opacity duration-200 data-open:opacity-100"
          />
          <Drawer.Content
            data-testid="orchestrator-sheet"
            class="fixed inset-x-0 bottom-0 top-8 z-50 rounded-t-2xl overflow-hidden border-t border-edge bg-surface-0"
          >
            <OrchestratorPane class="h-full" />
          </Drawer.Content>
        </Drawer.Portal>
      </Drawer>
    </Show>
  );
};

export default OrchestratorSheet;
