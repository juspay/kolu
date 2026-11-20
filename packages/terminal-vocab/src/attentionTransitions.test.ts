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
    expect(attentionTransitions(u([], ["a"]), u([], ["a"])).candidates).toEqual(
      [],
    );
  });

  it("ESCALATION finished→asking IS a candidate (the #1177 gate over an idle finish)", () => {
    const t = attentionTransitions(u([], ["a"]), u(["a"], []));
    expect(t.candidates).toEqual([{ id: "a", asking: true }]);
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
