// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from "vitest";
import { getActiveTerminalNode } from "./activeTerminal";

afterEach(() => {
  document.body.replaceChildren();
});

describe("getActiveTerminalNode", () => {
  it("returns the focused split instead of the active tile's first terminal", () => {
    document.body.innerHTML = `
      <div data-canvas-tile data-active="true">
        <div data-terminal-id="main" data-visible></div>
        <div data-terminal-id="split" data-visible data-focused></div>
      </div>
    `;

    expect(getActiveTerminalNode()?.dataset.terminalId).toBe("split");
  });

  it("falls back to the first visible terminal before focus is established", () => {
    document.body.innerHTML = `
      <div data-canvas-tile data-active="true">
        <div data-terminal-id="main" data-visible></div>
      </div>
    `;

    expect(getActiveTerminalNode()?.dataset.terminalId).toBe("main");
  });
});
