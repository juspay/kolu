import { describe, expect, it } from "vitest";
import {
  DEFAULT_SPLIT_PANEL_STATE,
  sameSplitPanelState,
  savedSplitOf,
} from "./splitPanelState";

describe("savedSplitOf", () => {
  const saved = { collapsed: true, panelSize: 0.42 } as const;
  const pending = { collapsed: false, panelSize: 0.25 } as const;

  it("answers the record when nothing is in flight", () => {
    expect(savedSplitOf(saved, undefined)).toBe(saved);
  });

  it("answers the user's in-flight change while the record catches up", () => {
    expect(savedSplitOf(saved, pending)).toBe(pending);
  });

  it("answers ONE default for a terminal whose record says nothing", () => {
    expect(savedSplitOf(undefined, undefined)).toBe(DEFAULT_SPLIT_PANEL_STATE);
    expect(DEFAULT_SPLIT_PANEL_STATE).toEqual({
      collapsed: false,
      panelSize: 0.3,
    });
  });

  it("prefers an in-flight change even for a terminal with no record", () => {
    expect(savedSplitOf(undefined, pending)).toBe(pending);
  });
});

describe("sameSplitPanelState", () => {
  it("is what says an in-flight change has landed", () => {
    expect(
      sameSplitPanelState(
        { collapsed: true, panelSize: 0.4 },
        { collapsed: true, panelSize: 0.4 },
      ),
    ).toBe(true);
    expect(
      sameSplitPanelState(
        { collapsed: true, panelSize: 0.4 },
        { collapsed: false, panelSize: 0.4 },
      ),
    ).toBe(false);
    expect(
      sameSplitPanelState(
        { collapsed: true, panelSize: 0.4 },
        { collapsed: true, panelSize: 0.41 },
      ),
    ).toBe(false);
  });
});
