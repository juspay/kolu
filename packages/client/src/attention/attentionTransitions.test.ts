/** Pins the #1177-class attention transition logic — the pure decision behind
 *  `useAttention`'s fire-once/escalation rules, tested off id-sets without the
 *  wire. */

import type { PadiUrgency } from "@kolu/padi/surface";
import type { TerminalId } from "kolu-common/surface";
import { describe, expect, it } from "vitest";
import { attentionTransitions } from "./attentionTransitions";

const u = (awaiting: string[], finished: string[] = []): PadiUrgency => ({
  awaitingIds: awaiting as TerminalId[],
  finishedIds: finished as TerminalId[],
});

describe("attentionTransitions", () => {
  it("baseline (prev=null): every current id is a candidate, none ended", () => {
    const t = attentionTransitions(null, u(["a"], ["b"]));
    expect(t.candidates).toEqual([
      { id: "a", asking: true },
      { id: "b", asking: false },
    ]);
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
