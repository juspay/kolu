/** Pins the #1177-class attention transition logic — the pure decision behind
 *  both kolu's browser alerts and padi's supervision-edge delivery, tested off
 *  id-sets without the wire. */

import { describe, expect, it } from "vitest";
import {
  type AttentionFrame,
  attentionTransitions,
  createAttentionTransitions,
} from "./attentionTransitions.ts";
import type { TerminalId } from "./schema.ts";

const u = (asking: string[], finished: string[] = []): AttentionFrame => ({
  asking: asking as TerminalId[],
  finished: finished as TerminalId[],
});

describe("attentionTransitions", () => {
  it("baseline (prev=null) is a discovery, not a transition: no candidates, none ended", () => {
    const t = attentionTransitions(null, u(["a"], ["b"]));
    expect(t.candidates).toEqual([]);
    expect(t.ended).toEqual([]);
  });

  it("a fresh finish is a candidate; steady state is not", () => {
    expect(attentionTransitions(u([], []), u([], ["a"])).candidates).toEqual([
      { id: "a", asking: false },
    ]);
    // Same set next frame → no new candidate.
    expect(attentionTransitions(u([], ["a"]), u([], ["a"])).candidates).toEqual(
      [],
    );
  });

  it("ESCALATION finished→asking IS a candidate (the #1177 gate over an idle finish)", () => {
    const t = attentionTransitions(u([], ["a"]), u(["a"], []));
    expect(t.candidates).toEqual([{ id: "a", asking: true }]);
    // `a` moved between sets, so it did NOT leave the class — no episode end.
    expect(t.ended).toEqual([]);
  });

  it("DE-escalation asking→finished is NOT a candidate", () => {
    expect(attentionTransitions(u(["a"], []), u([], ["a"])).candidates).toEqual(
      [],
    );
  });

  it("leaving BOTH sets (agent back to work) ends the episode", () => {
    const t = attentionTransitions(u(["a"], ["b"]), u([], []));
    expect(t.candidates).toEqual([]);
    expect(t.ended.sort()).toEqual(["a", "b"]);
  });

  it("a re-finish AFTER leaving is a fresh candidate again (new episode)", () => {
    // work → gone from both, then finishes again: episode boundary means it
    // qualifies to fire once more.
    expect(attentionTransitions(u([], []), u([], ["a"])).candidates).toEqual([
      { id: "a", asking: false },
    ]);
  });
});

describe("createAttentionTransitions — the MEMORY the decision needs", () => {
  it("the FIRST frame is a baseline, and the next one diffs against it", () => {
    const t = createAttentionTransitions();
    expect(t.observe(u(["a"], []))).toEqual({ candidates: [], ended: [] });
    expect(t.observe(u(["a"], ["b"])).candidates).toEqual([
      { id: "b", asking: false },
    ]);
  });

  it("COPIES the incoming lists — a caller may hand back the same arrays", () => {
    const t = createAttentionTransitions();
    // The real callers do exactly this: a SolidJS store that mutates its arrays
    // in place, and padi's re-folded urgency cell. Holding the reference would
    // make `prev` and `cur` the same object, so no transition is ever seen and
    // NOTHING FIRES — a silent failure, which is the one this whole vocabulary
    // exists to remove.
    const asking: TerminalId[] = [];
    const finished: TerminalId[] = [];
    const live: AttentionFrame = { asking, finished };
    t.observe(live);
    finished.push("a" as TerminalId);
    expect(t.observe(live).candidates).toEqual([{ id: "a", asking: false }]);
  });

  it("reset() makes the next frame a baseline again", () => {
    const t = createAttentionTransitions();
    t.observe(u([], []));
    t.reset();
    expect(t.observe(u([], ["a"])).candidates).toEqual([]);
  });
});
