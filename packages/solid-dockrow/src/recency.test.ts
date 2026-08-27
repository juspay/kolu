import { describe, expect, it } from "vitest";
import { displayRecencyAt, recencyMode, recencyText } from "./recency.ts";

describe("recencyMode", () => {
  it("a blocked row shows the wait chip even though its pip is active", () => {
    expect(recencyMode({ asking: true, active: true })).toBe("wait-chip");
  });

  it("an active row hides its age — it is 'just now' by definition", () => {
    expect(recencyMode({ asking: false, active: true })).toBe("hidden");
  });

  it("a quiet row shows its age", () => {
    expect(recencyMode({ asking: false, active: false })).toBe("ago");
  });
});

describe("displayRecencyAt", () => {
  it("keeps a blocked parent's wait duration on its own agent transition", () => {
    expect(displayRecencyAt("wait-chip", 2_000, 10)).toBe(10);
  });

  it("uses aggregate tile activity for the ordinary age and window", () => {
    expect(displayRecencyAt("ago", 2_000, 10)).toBe(2_000);
    expect(displayRecencyAt("hidden", 2_000, 10)).toBe(2_000);
  });
});

describe("recencyText — the words, per rendering", () => {
  const now = 10_000_000;
  const MIN = 60_000;
  const HOUR = 60 * MIN;

  // The `ago` cell is an AGE and carries its suffix. These four strings are the
  // ones the Dock renders today; the first consumer to re-spell them got three
  // of the four wrong ("7m", and the empty string for a wait chip).
  it.each([
    { at: null, expected: "" },
    { at: now - 30_000, expected: "just now" },
    { at: now - 7 * MIN, expected: "7m ago" },
    { at: now - 3 * HOUR, expected: "3h ago" },
  ])("ago: $at → $expected", ({ at, expected }) => {
    expect(recencyText("ago", at, now)).toBe(expected);
  });

  // The wait chip is a live DURATION and carries no suffix — the capsule sits in
  // the 8ch track and "ago" would wrap it.
  it.each([
    { at: now - 30_000, expected: "30s" },
    { at: now - 7 * MIN, expected: "7m" },
    { at: now - 20 * HOUR, expected: "20h" },
  ])("wait-chip: $at → $expected", ({ at, expected }) => {
    expect(recencyText("wait-chip", at, now)).toBe(expected);
  });

  it("renders the DASH where `ago` renders nothing — a capsule cannot be empty", () => {
    // The rule RecencyCell's own prop doc states: a violet pill with no glyph
    // reads as a rendering bug, not as "unknown". So the two renderings answer
    // a never-active row differently, on purpose.
    expect(recencyText("wait-chip", null, now)).toBe("—");
    expect(recencyText("ago", null, now)).toBe("");
  });

  it("says the dash in BOTH renderings when the host clock runs ahead", () => {
    // A remote host a minute ahead puts its events in this clock's future: the
    // reading is provably wrong, and one row must not show "—" beside "just now".
    const ahead = now + 60_000;
    expect(recencyText("ago", ahead, now)).toBe("—");
    expect(recencyText("wait-chip", ahead, now)).toBe("—");
  });
});
