import { createRoot } from "solid-js";
import { describe, expect, it } from "vitest";
import { useAnchoredPopover } from "./useAnchoredPopover";

describe("useAnchoredPopover", () => {
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
