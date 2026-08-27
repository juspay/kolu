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
  narrowRowVocab,
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

describe("narrowRowVocab — the guards WITH their defaults", () => {
  /** A fully-known wire row. The seven typed facts are the ones that must pass
   *  through untouched; the three closed-set words are the ones under test.
   *  `motion` is deliberately absent — it is not a wire fact. */
  const wire = () => ({
    pip: {
      variant: "working",
      glyph: "claude-code",
      active: true,
      asking: false,
      bytesLive: true,
      shellLive: false,
      sleeping: false,
      alert: false,
      alertLabel: "unread alert",
    },
    bucket: "working",
  });

  it("passes a known row through unchanged, and folds the motion", () => {
    const n = narrowRowVocab(wire());
    expect(n.pip).toEqual({ ...wire().pip, motion: "spin" });
    expect(n.bucket).toBe("working");
    expect(n.known).toBe(true);
  });

  it.each([
    { field: "variant", fallback: "idle" },
    { field: "glyph", fallback: "shell" },
    { field: "bucket", fallback: "idle" },
  ] as const)("an unknown $field falls back to $fallback AND keeps the word", ({
    field,
    fallback,
  }) => {
    const w = wire();
    if (field === "bucket") w.bucket = "sideways";
    else w.pip[field] = "sideways";
    const n = narrowRowVocab(w);
    const got = field === "bucket" ? n.bucket : n.pip[field];
    expect(got).toBe(fallback);
    // The fallback is what the row DRAWS; this is the fact it must not cost.
    // Reading it at all means having checked `known` — the union sees to that.
    expect(n.known).toBe(false);
    if (!n.known) expect(n.unrecognised[field]).toBe("sideways");
  });

  it("FOLDS the motion rather than transporting it — always, not only on a miss", () => {
    // `pipMotionKind` is a total function of the variant and `active`, so a
    // transported motion could only agree with the fold or contradict it. It is
    // recomputed from the variant this build will PAINT, which after a fallback
    // is not the one the wire named.
    expect(narrowRowVocab(wire()).pip.motion).toBe("spin");

    const asking = narrowRowVocab({
      ...wire(),
      pip: { ...wire().pip, variant: "awaiting" },
    });
    expect(asking.pip.motion).toBe("glow");

    const still = narrowRowVocab({
      ...wire(),
      pip: { ...wire().pip, active: false },
    });
    expect(still.pip.motion).toBe("none");

    // The tell that it follows the NARROWED variant: an unrecognised variant
    // falls back to `idle`, whose active motion is `spin` — not whatever an
    // unknown variant might have meant.
    const strange = narrowRowVocab({
      ...wire(),
      pip: { ...wire().pip, variant: "sideways" },
    });
    expect(strange.pip.variant).toBe("idle");
    expect(strange.pip.motion).toBe("spin");
  });

  it("never derives the ORDER bucket from the PAINT variant — they disagree", () => {
    // kolu's own case: a fresh `waiting` agent PAINTS `linger` (a dim glow)
    // while the ORDER fold ranks it `idle`. `Exclude<DockRowBucket, "linger">`
    // is the proof the two are different folds — so a wire that says so must
    // survive intact rather than have one re-derived from the other.
    const n = narrowRowVocab({
      pip: { ...wire().pip, variant: "linger" },
      bucket: "idle",
    });
    expect(n.pip.variant).toBe("linger");
    expect(n.bucket).toBe("idle");
    expect(n.known).toBe(true);
  });

  it("treats an inherited property name as the stranger it is", () => {
    // `Object.hasOwn`, never `in` — a wire word of "toString" must not narrow
    // as a member of a set it is not in. The guards already do this; this pins
    // that narrowRowVocab inherits it rather than re-testing membership itself.
    const n = narrowRowVocab({
      pip: { ...wire().pip, glyph: "toString" },
      bucket: "constructor",
    });
    expect(n.pip.glyph).toBe("shell");
    expect(n.bucket).toBe("idle");
    expect(n.known).toBe(false);
    if (!n.known)
      expect(n.unrecognised).toEqual({
        glyph: "toString",
        bucket: "constructor",
      });
  });
});
