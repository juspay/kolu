// @vitest-environment happy-dom

import { createSignal } from "solid-js";
import { render } from "solid-js/web";
import { describe, expect, it } from "vitest";
import { DockShortcutHint } from "./DockShortcutHint";

describe("DockShortcutHint", () => {
  it("appears while Mod is held and disappears when it is released", () => {
    const [held, setHeld] = createSignal(false);
    const host = document.createElement("div");
    const dispose = render(
      () => <DockShortcutHint flatIndex={1} modHeld={held} class="hint" />,
      host,
    );
    try {
      expect(host.textContent).toBe("");
      setHeld(true);
      expect(host.textContent).toBe("2");
      setHeld(false);
      expect(host.textContent).toBe("");
    } finally {
      dispose();
    }
  });

  it("only numbers the first nine flat dock rows", () => {
    const held = () => true;
    const ninth = document.createElement("div");
    const tenth = document.createElement("div");
    const disposeNinth = render(
      () => <DockShortcutHint flatIndex={8} modHeld={held} class="hint" />,
      ninth,
    );
    const disposeTenth = render(
      () => <DockShortcutHint flatIndex={9} modHeld={held} class="hint" />,
      tenth,
    );
    try {
      expect(ninth.textContent).toBe("9");
      expect(tenth.textContent).toBe("");
    } finally {
      disposeNinth();
      disposeTenth();
    }
  });
});
