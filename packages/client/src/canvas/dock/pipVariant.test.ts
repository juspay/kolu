import type { PipVariant } from "@kolu/solid-statepip";
import type { TerminalMetadata } from "@kolu/padi/surface";
import { describe, expect, it } from "vitest";
import type { DockRowBucket } from "./dockRowRanking";
import { pipGlyphFor, pipVariant } from "./pipVariant";

// The bucket carries only the CORE state now — `unread` is no longer folded in
// (R-activity-merge moved it to the indicator's `alert` corner badge). awaiting is the
// quiet lingering paint; working breathes; idle is muted; none/parked
// render empty; sleeping is moonlit + still (identity glyph, not ☾).
const cases: Array<[DockRowBucket, PipVariant]> = [
  ["awaiting", "awaiting"],
  ["working", "working"],
  ["idle", "idle"],
  ["none", "empty"],
  ["parked", "empty"],
  ["sleeping", "sleeping"],
];

describe("pipVariant", () => {
  for (const [bucket, expected] of cases) {
    it(`${bucket} → ${expected}`, () => {
      expect(pipVariant(bucket)).toBe(expected);
    });
  }
});

// pipGlyphFor only reads activeArm(meta)?.agent?.kind and meta.restoreTarget —
// cast partial fixtures rather than constructing a full TerminalMetadata.
describe("pipGlyphFor", () => {
  it("live agent kind wins", () => {
    const meta = {
      state: "active",
      agent: { kind: "grok", state: "thinking" },
    } as unknown as TerminalMetadata;
    expect(pipGlyphFor(meta)).toBe("grok");
  });

  it("sleeping row keeps the persisted exact identity", () => {
    const meta = {
      state: "sleeping",
      agent: null,
      restoreTarget: {
        kind: "exact",
        command: "claude",
        agent: { kind: "claude-code", sessionId: "abc" },
      },
    } as unknown as TerminalMetadata;
    expect(pipGlyphFor(meta)).toBe("claude-code");
  });

  it("plain shell (no agent, no exact restore) is the shell glyph", () => {
    expect(
      pipGlyphFor({
        state: "active",
        agent: null,
      } as unknown as TerminalMetadata),
    ).toBe("shell");
    expect(
      pipGlyphFor({
        state: "sleeping",
        agent: null,
        restoreTarget: { kind: "none" },
      } as unknown as TerminalMetadata),
    ).toBe("shell");
  });
});
