/** Pins the #1177-class attention transition logic — the pure decision behind
 *  `useAttention`'s fire-once/escalation rules, tested off id-sets without the
 *  wire. */

import type { TerminalId } from "kolu-common/surface";
import { describe, expect, it } from "vitest";
import {
  type AttentionFrame,
  attentionTransitions,
  nextUnseenFinished,
} from "./attentionTransitions";

const u = (asking: string[], finished: string[] = []): AttentionFrame => ({
  askingIds: asking as TerminalId[],
  finishedIds: finished as TerminalId[],
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
    // qualifies to chime once more.
    expect(attentionTransitions(u([], []), u([], ["a"])).candidates).toEqual([
      { id: "a", asking: false },
    ]);
  });
});

const S = (...ids: string[]) => new Set(ids as TerminalId[]);

// The fold now takes the ALREADY-computed transition candidates + the current
// finished ids ARRAY (observe threads in the `candidates` it already holds — no
// re-diff; the fold builds the finished lookup set itself, only when inactive).
const cand = (...c: Array<{ id: string; asking: boolean }>) =>
  c as Array<{ id: TerminalId; asking: boolean }>;
const F = (...ids: string[]) => ids as TerminalId[];

describe("nextUnseenFinished (the host-tab dot's meaning — the #<this-PR> dot bug)", () => {
  // THE BUG: the dot showed for any host with a finished agent, and a finished
  // agent idles in `waiting` ~forever — so the dot was on every host, always.
  it("a STEADY finished agent is NOT unseen (no fresh candidate)", () => {
    expect(nextUnseenFinished(S(), cand(), F("a"), false)).toEqual(S());
  });

  it("a finished agent present at BASELINE (discovery, no candidates) is NOT unseen", () => {
    expect(nextUnseenFinished(S(), cand(), F("a"), false)).toEqual(S());
  });

  it("a FRESH background finish IS unseen", () => {
    expect(
      nextUnseenFinished(S(), cand({ id: "a", asking: false }), F("a"), false),
    ).toEqual(S("a"));
  });

  it("an unseen finish on the ACTIVE host clears (you're looking at it)", () => {
    expect(nextUnseenFinished(S("a"), cand(), F("a"), true)).toEqual(S());
  });

  it("an unseen finish that goes back to work drops out", () => {
    expect(nextUnseenFinished(S("a"), cand(), F(), false)).toEqual(S());
  });

  it("an unseen finish that escalates to asking drops out (it's now the amber pill)", () => {
    expect(
      nextUnseenFinished(S("a"), cand({ id: "a", asking: true }), F(), false),
    ).toEqual(S());
  });
});
