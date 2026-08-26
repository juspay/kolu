/** The consistency law: a host's activity count and a terminal's pip motion are
 *  the same question, so they must answer identically for every possible
 *  terminal. The equivalence test below is the executable form of that — it is
 *  the reason the two can't drift, not a spot-check of a few cases. */

import type { AttentionClass } from "@kolu/terminal-vocab/agentProjection";
import type { TerminalId } from "@kolu/terminal-vocab/schema";
import {
  ATTENTION_CLASSES,
  attentionCounted,
} from "@kolu/terminal-vocab/agentProjection";
import { describe, expect, it } from "vitest";
import {
  EMPTY_FRAME,
  type FrameClass,
  type HostAttentionFrame,
  hostActiveIds,
  isActive,
  scopeAttention,
  type TerminalAttention,
} from "./attention.ts";

// The vocabulary's OWN enumeration, not a hand-written copy. A sixth class used
// to pass this file green while vanishing from every count, because the list
// the loop walked had no relation to the type — the test that was offered as
// the fence could not fence the change most likely to happen.
const CLASSES: readonly AttentionClass[] = ATTENTION_CLASSES;

/** A frame holding exactly one terminal in the given class, live or not. */
function oneTerminal(klass: AttentionClass, live: boolean): HostAttentionFrame {
  const id = "t1" as TerminalId;
  const liveIds = live ? [id] : [];
  if (klass === "idle") return { ...EMPTY_FRAME, liveIds };
  return {
    byClass: { ...EMPTY_FRAME.byClass, [klass satisfies FrameClass]: [id] },
    liveIds,
  };
}

describe("hostActiveIds ⇄ attentionCounted equivalence", () => {
  // The law: for every terminal a host could hold, the host's activity count
  // includes it exactly when the shared counting predicate says it should. The
  // exception `asking` used to be WRITTEN OUT here (`moving && klass !==
  // "asking"`), which was the fingerprint that the shared function was not the
  // shared rule — the test restated the exception instead of proving there
  // wasn't one. Now it is a tautology against the vocabulary.
  for (const klass of CLASSES) {
    for (const live of [false, true]) {
      it(`agrees for ${klass} ${live ? "with" : "without"} live output`, () => {
        const counted = hostActiveIds(oneTerminal(klass, live)).length === 1;
        expect(counted).toBe(attentionCounted(klass, live));
      });
    }
  }
});

describe("isActive", () => {
  // The recency cell hides "Xs ago" on active rows — active ⇒ "just now" by
  // definition, so the label is noise. These rules therefore govern the label
  // as well as the motion; a change here must re-think both.
  it("a shell is active only while it prints", () => {
    expect(isActive({ klass: "idle", live: true })).toBe(true);
    expect(isActive({ klass: "idle", live: false })).toBe(false);
  });

  it("a working agent is active whether or not a byte moved", () => {
    expect(isActive({ klass: "working", live: false })).toBe(true);
  });

  it("a blocked agent is active — the glow channel", () => {
    expect(isActive({ klass: "asking", live: false })).toBe(true);
  });

  it("a finished turn stays active while it lingers, then stops", () => {
    expect(isActive({ klass: "linger", live: false })).toBe(true);
    expect(isActive({ klass: "finished", live: false })).toBe(false);
  });

  // Sticky EF2 finish must not silence motion while the terminal is still
  // printing (#1955): the finished class answers the chime, live output
  // answers motion.
  it("a finished agent that is still printing is active", () => {
    expect(isActive({ klass: "finished", live: true })).toBe(true);
  });
});

describe("hostActiveIds", () => {
  it("counts a still-lingering agent — the pip is still moving, so the tab says so", () => {
    // The pureintent bug: one agent had finished its turn but was still
    // settling, its pip visibly spinning violet, and the host tab counted
    // nothing at all because only the working list fed the count.
    const id = "settling" as TerminalId;
    const frame: HostAttentionFrame = {
      byClass: { ...EMPTY_FRAME.byClass, linger: [id] },
      liveIds: [],
    };
    expect(hostActiveIds(frame)).toEqual([id]);
  });

  it("counts a plain shell that is printing — no agent to ask, bytes are the evidence", () => {
    // The naiveintent bug: three terminals were visibly working but the tab
    // said two, because kolu held no agent state for the third and only its
    // byte stream knew.
    const frame: HostAttentionFrame = {
      byClass: {
        ...EMPTY_FRAME.byClass,
        working: ["a" as TerminalId, "b" as TerminalId],
      },
      liveIds: ["c" as TerminalId],
    };
    expect(hostActiveIds(frame)).toHaveLength(3);
  });

  it("counts a working agent once, not twice, when it is also printing", () => {
    const id = "busy" as TerminalId;
    const frame: HostAttentionFrame = {
      byClass: { ...EMPTY_FRAME.byClass, working: [id] },
      liveIds: [id],
    };
    expect(hostActiveIds(frame)).toEqual([id]);
  });

  it("leaves a blocked agent out — it is counted in violet, and never in both", () => {
    const id = "blocked" as TerminalId;
    const frame: HostAttentionFrame = {
      byClass: { ...EMPTY_FRAME.byClass, asking: [id] },
      // Even while it prints: an agent that asked a question and then echoed
      // some output is still blocked on you, not busy.
      liveIds: [id],
    };
    expect(hostActiveIds(frame)).toEqual([]);
  });

  it("drops a finished agent once its output stops", () => {
    const id = "done" as TerminalId;
    const finished = { ...EMPTY_FRAME.byClass, finished: [id] };
    expect(hostActiveIds({ byClass: finished, liveIds: [] })).toEqual([]);
    expect(hostActiveIds({ byClass: finished, liveIds: [id] })).toEqual([id]);
  });
});

describe("scopeAttention", () => {
  const attention =
    (map: Record<string, TerminalAttention>) => (id: TerminalId) =>
      map[id as string] ?? { klass: "idle" as const, live: false };

  it("counts activity on the same predicate the pips move on", () => {
    // A working agent, an agent still lingering after its turn, and a plain
    // shell that is printing: three moving marks, so three counted. Counting
    // only `working` here is what made a host tab read 1 beside three moving
    // pips.
    const attn = scopeAttention(
      ["a", "b", "c"] as TerminalId[],
      () => false,
      attention({
        a: { klass: "working", live: true },
        b: { klass: "linger", live: false },
        c: { klass: "idle", live: true },
      }),
    );
    expect(attn.activeIds).toEqual(["a", "b", "c"]);
    expect(attn.askingIds).toEqual([]);
    expect(attn.unseenIds).toEqual([]);
  });

  it("puts a blocked agent in the violet leg, never also in the rust one", () => {
    const attn = scopeAttention(
      ["a"] as TerminalId[],
      () => false,
      attention({ a: { klass: "asking", live: true } }),
    );
    expect(attn.activeIds).toEqual([]);
    expect(attn.askingIds).toEqual(["a"]);
  });

  it("counts unread independently — it is the badge axis, not the colour axis", () => {
    // A row genuinely wears both: a rust pip with an amber corner badge. The
    // header must say what the row says.
    const attn = scopeAttention(
      ["a"] as TerminalId[],
      () => true,
      attention({ a: { klass: "working", live: true } }),
    );
    expect(attn.activeIds).toEqual(["a"]);
    expect(attn.unseenIds).toEqual(["a"]);
  });

  it("returns the ids it counted, so a capsule's click reaches what its number promised", () => {
    // The count folded rows the dock had hidden and agents living in splits;
    // the click re-filtered the VISIBLE rows and reached neither, rendering a
    // button that said "1" and did nothing.
    const attn = scopeAttention(
      ["parked-blocked", "split-agent"] as TerminalId[],
      () => false,
      attention({
        "parked-blocked": { klass: "asking", live: false },
        "split-agent": { klass: "working", live: true },
      }),
    );
    expect(attn.askingIds).toEqual(["parked-blocked"]);
    expect(attn.activeIds).toEqual(["split-agent"]);
  });
});
