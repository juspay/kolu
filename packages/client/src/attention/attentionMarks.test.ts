/** The dependency separation the dock's cost rests on.
 *
 *  Two facts arrive per host on very different clocks: the attention CLASS
 *  moves when an agent transitions, and the LIVE set churns on kaval's ~1 s
 *  byte-motion window — every time any terminal prints a line. The dock's
 *  rank-and-paint memo is an O(n log n) sort plus a regroup, and it reads the
 *  class.
 *
 *  So a class read must never subscribe to `liveIds`. If it does, a terminal
 *  printing output re-sorts the whole dock once a second, and nothing on screen
 *  changes to show for it. This is a re-run-count test rather than a value test
 *  for that reason — the answers stay correct either way; it is the WAKING that
 *  regresses, silently, and only under load.
 *
 *  It is easy to lose by tidying: the obvious simplification is one memo
 *  covering the whole frame. These tests are what should stop that. */

import type { TerminalId } from "kolu-common/surface";
import { createComputed, createRoot } from "solid-js";
import { beforeEach, describe, expect, it } from "vitest";
import {
  forgetHostIndex,
  hostFrame,
  terminalClass,
  writeHostMarks,
} from "./attentionMarks";

const HOST = "local";
const A = "t-a" as TerminalId;

beforeEach(() => {
  writeHostMarks(HOST, undefined);
  forgetHostIndex(HOST);
});

/** Count how many times a reactive read of `fn` re-runs, driving `steps`
 *  between counts. Returns the count after each step. */
function countReruns(fn: () => unknown, steps: readonly (() => void)[]) {
  return createRoot((dispose) => {
    let runs = 0;
    createComputed(() => {
      fn();
      runs += 1;
    });
    const after: number[] = [];
    for (const step of steps) {
      step();
      after.push(runs);
    }
    dispose();
    return after;
  });
}

describe("a class read does not wake on the live set", () => {
  it("holds still across byte-motion writes, then moves on a real class change", () => {
    writeHostMarks(HOST, {
      reported: true,
      byClass: { asking: [], working: [A], linger: [], finished: [] },
    });

    const after = countReruns(
      () => terminalClass(HOST, A),
      [
        // Three consecutive live-set writes — a terminal printing output.
        () => writeHostMarks(HOST, { liveIds: [A] }),
        () => writeHostMarks(HOST, { liveIds: [] }),
        () => writeHostMarks(HOST, { liveIds: [A] }),
        // Now the agent actually transitions.
        () =>
          writeHostMarks(HOST, {
            byClass: { asking: [A], working: [], linger: [], finished: [] },
          }),
      ],
    );

    // One initial run, unmoved by all three byte ticks…
    expect(after.slice(0, 3)).toEqual([1, 1, 1]);
    // …and exactly one more when the class genuinely changed.
    expect(after[3]).toBe(2);
  });

  it("still reports the right class either way", () => {
    // The separation is about WAKING, not about answers — pin the answers too,
    // so a future fix for one can't quietly break the other.
    writeHostMarks(HOST, {
      reported: true,
      byClass: { asking: [], working: [A], linger: [], finished: [] },
      liveIds: [],
    });
    expect(terminalClass(HOST, A)).toBe("working");

    writeHostMarks(HOST, { liveIds: [A] });
    expect(terminalClass(HOST, A)).toBe("working");

    writeHostMarks(HOST, {
      byClass: { asking: [A], working: [], linger: [], finished: [] },
    });
    expect(terminalClass(HOST, A)).toBe("asking");
  });

  it("leaves the untouched legs referentially identical, which is what carries it", () => {
    // The mechanism underneath: Solid's store writes per-property, so a
    // `liveIds`-only merge never replaces the `byClass` node. If a future
    // `writeHostMarks` rebuilt the record wholesale, every test above would
    // still pass on values and the waking would regress — this is the guard
    // for that.
    writeHostMarks(HOST, {
      reported: true,
      byClass: { asking: [], working: [A], linger: [], finished: [] },
    });
    const before = hostFrame(HOST).byClass;
    writeHostMarks(HOST, { liveIds: [A] });
    expect(hostFrame(HOST).byClass).toBe(before);
  });
});
