import { createRoot } from "solid-js";
import { describe, expect, it } from "vitest";
import { useAnchoredPopover } from "./useAnchoredPopover";

describe("useAnchoredPopover", () => {
  // Regression for the mobile Code-tab mode picker: the popover panel is
  // rendered via `<Portal>` to `document.body`. On mobile the right panel
  // lives inside a Corvu `Drawer` (`@corvu/dialog`, `modal: true`), which
  // sets `body { pointer-events: none }` and only re-enables pointer events
  // on its own dialog content. A body-level portal therefore inherits `none`
  // unless the panel re-enables it — without this the dropdown opens but
  // tapping any of its items does nothing. The panel style must always carry
  // `pointer-events: auto` so the popover stays interactive under any ambient
  // modal layer.
  it("always emits pointer-events: auto so a body-level portal stays tappable", () => {
    createRoot((dispose) => {
      const { panelStyle } = useAnchoredPopover({
        triggerRef: () => undefined,
        open: () => false,
        onDismiss: () => {},
      });
      expect(panelStyle()["pointer-events"]).toBe("auto");
      dispose();
    });
  });
});
