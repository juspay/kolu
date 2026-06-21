import type { RightPanelPerTerminalState } from "kolu-common/surface";
import { describe, expect, it } from "vitest";
import { rightPanelStateEqual } from "./terminals.ts";

// `setRightPanelState` gates its metadata publish on `rightPanelStateEqual` —
// equal states skip the publish so a file-tree click or tab toggle doesn't fan
// a full per-key metadata write on every interaction. The Notes Edit↔Preview
// toggle is one of those interactions: its only delta is `notesMode`, so the
// guard MUST notice it (#1499 regression — a notesMode-only change was being
// swallowed and the user's Notes sub-view never persisted/published).
describe("rightPanelStateEqual", () => {
  const base: RightPanelPerTerminalState = {
    activeTab: "notes",
    codeMode: "browse",
    notesMode: "edit",
  };

  it("a notesMode-only toggle is detected (not swallowed)", () => {
    const preview = { ...base, notesMode: "preview" as const };
    expect(rightPanelStateEqual(base, preview)).toBe(false);
  });

  it("treats an absent notesMode and an explicit 'edit' as equal (default site)", () => {
    // `notesModeOf` resolves the absent field to "edit", so a state that omits
    // notesMode must compare equal to one that spells it out — otherwise the
    // guard would publish on every no-op load and defeat its own purpose.
    const absent: RightPanelPerTerminalState = {
      activeTab: "notes",
      codeMode: "browse",
    };
    expect(rightPanelStateEqual(absent, base)).toBe(true);
  });

  it("identical states compare equal", () => {
    expect(rightPanelStateEqual(base, { ...base })).toBe(true);
  });
});
