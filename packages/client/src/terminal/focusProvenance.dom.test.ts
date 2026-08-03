// @vitest-environment happy-dom

import { Effect } from "effect";
import type { TerminalId } from "kolu-common/surface";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  focused: null as string | null,
  writeFocus: vi.fn(),
  setSubPanel: vi.fn(() => Effect.void),
}));

vi.mock("../hostScope/hostScopes", () => ({
  activeScope: () => ({
    view: {
      focusedTerminalId: () => h.focused,
      writeFocus: h.writeFocus,
    },
  }),
}));

vi.mock("../wire", () => ({
  activePadiRpc: { chrome: { setSubPanel: h.setSubPanel } },
}));

vi.mock("solid-sonner", () => ({
  toast: { error: vi.fn() },
}));

import {
  createFocusProvenance,
  installTerminalFocusProvenance,
} from "./focusProvenance";
import { useSubPanel } from "./useSubPanel";

const PARENT = "provenance-parent" as TerminalId;
const SUB = "provenance-sub" as TerminalId;

describe("terminal focus provenance DOM boundary", () => {
  beforeEach(() => {
    useSubPanel().removePanel(PARENT);
    h.focused = null;
    h.writeFocus.mockReset();
    h.writeFocus.mockImplementation(
      (next: { id: TerminalId } | null) => (h.focused = next?.id ?? null),
    );
    h.setSubPanel.mockClear();
    document.body.innerHTML = `
      <div data-testid="tile">
        <button type="button" data-testid="chrome">Toggle split</button>
        <div data-testid="pane"><textarea /></div>
      </div>
    `;
  });

  afterEach(() => {
    document.body.replaceChildren();
  });

  it("ignores chrome provenance but commits a gesture inside the pane", () => {
    const panel = useSubPanel();
    const tile = document.querySelector<HTMLElement>("[data-testid=tile]");
    const chrome = document.querySelector<HTMLElement>("[data-testid=chrome]");
    const pane = document.querySelector<HTMLElement>("[data-testid=pane]");
    const textarea = pane?.querySelector("textarea");
    expect(tile).not.toBeNull();
    expect(chrome).not.toBeNull();
    expect(pane).not.toBeNull();
    expect(textarea).not.toBeNull();
    if (!tile || !chrome || !pane || !textarea) return;

    panel.focusSubTab(PARENT, SUB);
    h.writeFocus.mockClear();
    const dispose = installTerminalFocusProvenance({
      pane,
      textarea,
      isFocused: () => h.focused === PARENT,
      onFocus: () => panel.focusMainPane(PARENT),
      provenance: createFocusProvenance(() => 0),
    });

    chrome.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    textarea.focus();

    expect(h.focused).toBe(SUB);
    expect(panel.peekSubPanel(PARENT).rememberedPane).toBe("sub");
    expect(h.writeFocus).not.toHaveBeenCalled();

    textarea.blur();
    pane.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    textarea.focus();

    expect(h.focused).toBe(PARENT);
    expect(panel.peekSubPanel(PARENT).rememberedPane).toBe("main");
    expect(h.writeFocus).toHaveBeenCalledExactlyOnceWith({
      id: PARENT,
      tileHint: PARENT,
    });

    dispose();
  });
});
