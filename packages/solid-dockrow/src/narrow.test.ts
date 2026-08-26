/** The narrowing a consumer fills the prop bag with — and, above all, what it
 *  does with a state this build has never heard of.
 *
 *  The bag is the ONE closed set for kolu's agent-state vocabulary. A mirror
 *  whose wire carries that state as plain text must be able to get from the
 *  string into the bag without declaring a second copy of the literals, and an
 *  unrecognised literal must reach the screen rather than vanish — those two
 *  facts are what these tests hold. */

import {
  isPipGlyphId,
  isPipMotionKind,
  isPipVariant,
  PIP_GLYPH_IDS,
  PIP_MOTION_KINDS,
  PIP_VARIANTS,
} from "@kolu/solid-statepip/pipVariant";
import { describe, expect, it } from "vitest";
import {
  DOCK_ROW_BUCKETS,
  isDockRowBucket,
  isRecencyMode,
  isRowAgentState,
  narrowAgentState,
  RECENCY_MODES,
  ROW_AGENT_STATES,
} from "./narrow.ts";

describe("every closed set the prop bag names is enumerable and guarded", () => {
  const sets = [
    { name: "agent state", all: ROW_AGENT_STATES, is: isRowAgentState },
    { name: "row bucket", all: DOCK_ROW_BUCKETS, is: isDockRowBucket },
    { name: "recency mode", all: RECENCY_MODES, is: isRecencyMode },
    { name: "pip variant", all: PIP_VARIANTS, is: isPipVariant },
    { name: "pip motion", all: PIP_MOTION_KINDS, is: isPipMotionKind },
    { name: "pip glyph", all: PIP_GLYPH_IDS, is: isPipGlyphId },
  ] as const;

  for (const set of sets) {
    it(`${set.name}: the guard admits every member and nothing else`, () => {
      expect(set.all.length).toBeGreaterThan(0);
      for (const member of set.all) expect(set.is(member)).toBe(true);
      expect(set.is("definitely-not-a-member")).toBe(false);
      // The guard must not answer yes for an inherited `Object.prototype` key —
      // an `in` check over a plain object record would (`"toString" in {}`).
      expect(set.is("toString")).toBe(false);
      expect(set.is("constructor")).toBe(false);
    });
  }
});

describe("narrowAgentState", () => {
  it("hands back the typed literal and its label for a state we know", () => {
    expect(narrowAgentState("awaiting_user")).toEqual({
      state: "awaiting_user",
      attr: "awaiting_user",
      label: "Awaiting input",
      known: true,
    });
  });

  it("reads a null/absent wire value as 'no agent', not as an unknown state", () => {
    for (const absent of [null, undefined, ""]) {
      expect(narrowAgentState(absent)).toEqual({
        state: undefined,
        attr: undefined,
        label: "",
        known: true,
      });
    }
  });

  // THE ONE THIS FILE EXISTS FOR. A mirror pinned to an older kolu meets a
  // state a newer padi invented. It must not be silently normalised onto a
  // neighbouring state, and it must not disappear: the word reaches the row.
  it("keeps an unrecognised state VISIBLE and withholds only the typed literal", () => {
    const out = narrowAgentState("compacting_context");
    // No fold is handed a state it cannot decide...
    expect(out.state).toBeUndefined();
    // ...but the row still shows the word, in the attribute AND in the subline.
    expect(out.attr).toBe("compacting_context");
    expect(out.label).toBe("compacting_context");
    expect(out.known).toBe(false);
  });

  it("never reports an unrecognised state as known", () => {
    for (const raw of ["", "thinking", "toString", "banana"]) {
      expect(narrowAgentState(raw).known).toBe(
        isRowAgentState(raw) || raw === "",
      );
    }
  });
});
