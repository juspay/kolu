import { describe, expect, it } from "vitest";
import {
  DEFAULT_SPLIT_PANEL_STATE,
  sameSplitPanelState,
  savedSplitOf,
} from "./splitPanelState";

/** The one-source read, as a rule: a tile's split state is the record's, with
 *  the user's in-flight change in front of it and ONE default behind it.
 *
 *  Pinned here because the defect it replaces (kolu#2362) was a second place
 *  for the answer to live: a browser-side copy that said "not collapsed, 30%"
 *  until a restore filled it in, which every mount then laid its tile out from
 *  and wrote back. */
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
    // A terminal that never had a split, and a brand-new one, read the same —
    // and read it from here, so no second answer can exist.
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
