/** The consistency law: a host's activity count and a terminal's pip motion are
 *  the same question, so they must answer identically for every possible
 *  terminal. The equivalence test below is the executable form of that — it is
 *  the reason the two can't drift, not a spot-check of a few cases. */

import type { TerminalId } from "kolu-common/surface";
import { describe, expect, it } from "vitest";
import {
  type HostAttentionFrame,
  hostActiveIds,
  isActive,
} from "./attentionFacts";

const CLASSES = ["asking", "working", "linger", "finished", "idle"] as const;

const EMPTY: HostAttentionFrame = {
  askingIds: [],
  workingIds: [],
  lingerIds: [],
  finishedIds: [],
  liveIds: [],
};

/** A frame holding exactly one terminal in the given class, live or not. */
function oneTerminal(
  klass: (typeof CLASSES)[number],
  live: boolean,
): HostAttentionFrame {
  const id = "t1" as TerminalId;
  const liveIds = live ? [id] : [];
  switch (klass) {
    case "asking":
      return { ...EMPTY, askingIds: [id], liveIds };
    case "working":
      return { ...EMPTY, workingIds: [id], liveIds };
    case "linger":
      return { ...EMPTY, lingerIds: [id], liveIds };
    case "finished":
      return { ...EMPTY, finishedIds: [id], liveIds };
    case "idle":
      return { ...EMPTY, liveIds };
  }
}

describe("hostActiveIds ⇄ isActive equivalence", () => {
  // The law: for every terminal a host could hold, the host's activity count
  // includes it exactly when its own pip would be moving — except for `asking`,
  // which is active but has its OWN violet count and so must not also swell the
  // rust one. Any future edit that teaches one altitude a new rule and not the
  // other reds here.
  for (const klass of CLASSES) {
    for (const live of [false, true]) {
      it(`agrees for ${klass} ${live ? "with" : "without"} live output`, () => {
        const counted = hostActiveIds(oneTerminal(klass, live)).length === 1;
        const moving = isActive({ klass, live });
        expect(counted).toBe(moving && klass !== "asking");
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
  // printing (#1955): finishedIds answers the chime, live output answers motion.
  it("a finished agent that is still printing is active", () => {
    expect(isActive({ klass: "finished", live: true })).toBe(true);
  });
});

describe("hostActiveIds", () => {
  it("counts a still-lingering agent — the pip is still moving, so the tab says so", () => {
    // The pureintent bug: one agent had finished its turn but was still
    // settling, its pip visibly spinning violet, and the host tab counted
    // nothing at all because only `workingIds` fed the count.
    const frame: HostAttentionFrame = {
      ...EMPTY,
      lingerIds: ["settling" as TerminalId],
    };
    expect(hostActiveIds(frame)).toEqual(["settling"]);
  });

  it("counts a plain shell that is printing — no agent to ask, bytes are the evidence", () => {
    // The naiveintent bug: three terminals were visibly working but the tab
    // said two, because kolu held no agent state for the third and only its
    // byte stream knew.
    const frame: HostAttentionFrame = {
      ...EMPTY,
      workingIds: ["a" as TerminalId, "b" as TerminalId],
      liveIds: ["c" as TerminalId],
    };
    expect(hostActiveIds(frame)).toHaveLength(3);
  });

  it("counts a working agent once, not twice, when it is also printing", () => {
    const id = "busy" as TerminalId;
    const frame: HostAttentionFrame = {
      ...EMPTY,
      workingIds: [id],
      liveIds: [id],
    };
    expect(hostActiveIds(frame)).toEqual([id]);
  });

  it("leaves a blocked agent out — it is counted in violet, and never in both", () => {
    const id = "blocked" as TerminalId;
    const frame: HostAttentionFrame = {
      ...EMPTY,
      askingIds: [id],
      // Even while it prints: an agent that asked a question and then echoed
      // some output is still blocked on you, not busy.
      liveIds: [id],
    };
    expect(hostActiveIds(frame)).toEqual([]);
  });

  it("drops a finished agent once its output stops", () => {
    const id = "done" as TerminalId;
    expect(hostActiveIds({ ...EMPTY, finishedIds: [id] })).toEqual([]);
    expect(
      hostActiveIds({ ...EMPTY, finishedIds: [id], liveIds: [id] }),
    ).toEqual([id]);
  });
});
