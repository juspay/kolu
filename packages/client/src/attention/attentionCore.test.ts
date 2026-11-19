/** Coverage for the detect→fire engine — the path `__koluSimulateAlert` (and so
 *  e2e) bypasses. Reproduces the reported deploy bug: a background terminal that
 *  FINISHES must fire an alert. */

import type { TerminalId } from "kolu-common/surface";
import type { Membership } from "kolu-work";
import { describe, expect, it, vi } from "vitest";
import { drivenByConductor } from "../conductor/workReadings";
import {
  type AttentionHooks,
  type AttentionMemory,
  createAttentionCore,
} from "./attentionCore";
import type { AttentionFrame } from "kolu-common/surface";

const u = (asking: string[] = [], finished: string[] = []): AttentionFrame => ({
  asking: asking as TerminalId[],
  finished: finished as TerminalId[],
});

function harness(over: Partial<AttentionHooks> = {}) {
  const delivered: Array<{ id: string; asking: boolean }> = [];
  /** The deliveries that made NO sound and no OS popup — only the marks. */
  const quiet: string[] = [];
  const cleared: Array<{ host: string; id: string }> = [];
  /** What the engine handed back to be saved, per host, latest last. */
  const remembered: Array<{ host: string; memory: AttentionMemory }> = [];
  const hooks: AttentionHooks = {
    alertsEnabled: () => true,
    isActiveHost: () => true,
    isWatched: () => false, // nothing watched by default (background)
    isDriven: () => false,
    deliver: (_h, id, asking, loud) => {
      delivered.push({ id, asking });
      if (!loud) quiet.push(id);
    },
    writeMark: () => {},
    clearUnread: (host, id) => cleared.push({ host, id }),
    resume: () => null, // a browser that has saved nothing
    remember: (host, memory) => remembered.push({ host, memory }),
    ...over,
  };
  return {
    core: createAttentionCore(hooks),
    delivered,
    quiet,
    cleared,
    remembered,
  };
}

describe("attentionCore — a terminal the Conductor drives", () => {
  /** The membership index, as `membershipOf` hands it out, keyed by fleet
   *  ref: the planner the Conductor drives, the implementor the human took
   *  over, and a member of a plain watch nobody drives. */
  const membership = new Map<string, Membership>([
    [
      "local/planner",
      { work: "w", title: "w", role: "planner", driver: "conductor" },
    ],
    [
      "local/implementor",
      { work: "w", title: "w", role: "implementor", driver: "you" },
    ],
    [
      "local/watched",
      { work: "v", title: "v", role: "other", driver: "nobody" },
    ],
  ]);
  const harnessed = () =>
    harness({
      isDriven: (encHost, id) => drivenByConductor(membership, encHost, id),
    });

  it("is silent — its question draws the mark and rings nothing", () => {
    const { core, delivered, quiet } = harnessed();
    core.observe("local", u([], []));
    core.observe("local", u(["planner"], []));
    expect(delivered).toEqual([{ id: "planner", asking: true }]);
    expect(quiet).toEqual(["planner"]);
  });

  it("rings once the human has taken it over, and for a watch or no work", () => {
    const { core, quiet, delivered } = harnessed();
    core.observe("local", u([], []));
    core.observe("local", u(["implementor", "watched", "loose"], []));
    expect(delivered).toHaveLength(3);
    expect(quiet).toEqual([]);
  });

  it("is about THIS host's terminal: the same id on another host rings", () => {
    const { core, quiet } = harnessed();
    core.observe("remote:box", u([], []));
    core.observe("remote:box", u(["planner"], []));
    expect(quiet).toEqual([]);
  });
});

describe("attentionCore — detect→fire (the path e2e/simulate skips)", () => {
  it("REPRO: a background terminal that finishes fires an alert", () => {
    const { core, delivered } = harness();
    core.observe("h", u([], [])); // baseline — agent working
    core.observe("h", u([], ["B"])); // B finishes, in the background
    expect(delivered).toEqual([{ id: "B", asking: false }]);
  });

  it("REPRO: a background finish on a BACKGROUND host fires too", () => {
    const { core, delivered } = harness({ isActiveHost: () => false });
    core.observe("h", u([], []));
    core.observe("h", u([], ["B"]));
    expect(delivered).toEqual([{ id: "B", asking: false }]);
  });

  it("a finish already present at baseline does NOT fire (discovery, not a transition)", () => {
    const { core, delivered } = harness();
    core.observe("h", u([], ["B"])); // first frame already finished
    expect(delivered).toEqual([]);
  });

  it("a finish you are WATCHING does not fire (you saw it)", () => {
    const { core, delivered } = harness({ isWatched: (_h, id) => id === "B" });
    core.observe("h", u([], []));
    core.observe("h", u([], ["B"]));
    expect(delivered).toEqual([]);
  });

  it("alerts OFF suppresses the fire", () => {
    const { core, delivered } = harness({ alertsEnabled: () => false });
    core.observe("h", u([], []));
    core.observe("h", u([], ["B"]));
    expect(delivered).toEqual([]);
  });

  it("fires once per episode, then again after the agent goes back to work", () => {
    const { core, delivered } = harness();
    core.observe("h", u([], []));
    core.observe("h", u([], ["B"])); // finish → fire
    core.observe("h", u([], ["B"])); // steady → no re-fire
    core.observe("h", u([], [])); // back to work (episode end)
    core.observe("h", u([], ["B"])); // finishes again → fire
    expect(delivered).toEqual([
      { id: "B", asking: false },
      { id: "B", asking: false },
    ]);
  });

  it("EF2 sticky: steady finishedIds while waiting does not re-deliver", () => {
    // Product decision (field-corrected): sticky-per-episode on the server —
    // finishedIds stays set for the whole waiting episode, so mid-waiting TUI
    // noise never un-finishes. The client must not re-fire on steady finished
    // frames; only leave-both-sets (back to work) re-arms for a later finish.
    const { core, delivered } = harness();
    core.observe("h", u([], [])); // baseline — working
    core.observe("h", u([], ["B"])); // first finish → fire once
    core.observe("h", u([], ["B"])); // steady (server sticky; noise while waiting)
    core.observe("h", u([], ["B"])); // still finished
    expect(delivered).toEqual([{ id: "B", asking: false }]);
    core.observe("h", u([], [])); // back to work — episode end, latch clears
    core.observe("h", u([], ["B"])); // new episode → fire again
    expect(delivered).toEqual([
      { id: "B", asking: false },
      { id: "B", asking: false },
    ]);
  });

  it("REPRO (deploy bug): detects a transition even when the cell REUSES one mutated object", () => {
    // The live surface delivers cell values via SolidJS `reconcile` — ONE object
    // mutated in place across frames. If the engine keeps a REFERENCE to it as
    // `prev`, then `prev` and `cur` are the same mutated object and no transition
    // is ever seen. The engine must snapshot. (Unit tests that pass fresh objects
    // each frame never hit this — the exact gap that let the deploy bug through.)
    const { core, delivered } = harness();
    // ONE object, reused + mutated (reconcile). Spelled mutably here on
    // purpose — `AttentionFrame` is readonly, and the whole point of this test
    // is what happens when the caller's object is not.
    const frame: { asking: TerminalId[]; finished: TerminalId[] } = {
      asking: [],
      finished: [],
    };
    core.observe("h", frame); // baseline
    frame.finished = ["B"] as TerminalId[]; // mutate in place
    core.observe("h", frame); // same object, now finished
    expect(delivered).toEqual([{ id: "B", asking: false }]);
  });

  it("REPRO: a baseline-asking terminal that settle-flaps (asking→waiting→asking) does NOT phantom-chime", () => {
    // A terminal already ASKING when the host binds (e.g. an app reload catching it
    // mid-ask) is a discovery, not a transition. If it then flaps asking→waiting→
    // asking (a settle jitter), the finished→asking re-escalation must NOT chime —
    // the terminal never left the attention episode. The retired per-terminal
    // machine pinned this by pre-latching a first-sighted awaiting id.
    const { core, delivered } = harness();
    core.observe("h", u(["A"], [])); // baseline — A already asking
    core.observe("h", u([], ["A"])); // A → waiting (de-escalation, no chime)
    core.observe("h", u(["A"], [])); // A → asking again (flap) — must NOT chime
    expect(delivered).toEqual([]);
  });

  it("a baseline-asking terminal that goes back to WORK then re-asks DOES chime (fresh episode)", () => {
    // The pre-latch is not permanent: leaving both sets (back to work) is the
    // episode boundary that clears the latch, so a genuine later ask fires.
    const { core, delivered } = harness();
    core.observe("h", u(["A"], [])); // baseline — A already asking (pre-latched)
    core.observe("h", u([], [])); // A → working (episode end, latch clears)
    core.observe("h", u(["A"], [])); // A asks again — fresh episode → chimes
    expect(delivered).toEqual([{ id: "A", asking: true }]);
  });

  it("an asking gate fires with asking=true", () => {
    const { core, delivered } = harness();
    core.observe("h", u([], []));
    core.observe("h", u(["B"], []));
    expect(delivered).toEqual([{ id: "B", asking: true }]);
  });

  it("publishes the unseen-finished mark for the dot (background host only)", () => {
    const writeMark = vi.fn();
    // On the ACTIVE host the mark is always 0 (you're looking); the dot is a
    // BACKGROUND-host cue, so drive it as background.
    const { core } = harness({ isActiveHost: () => false, writeMark });
    core.observe("h", u([], []));
    core.observe("h", u([], ["B"]));
    expect(writeMark).toHaveBeenLastCalledWith("h", 1);
  });

  it("a FINISHED terminal that goes back to work clears its unread mark", () => {
    const { core, cleared } = harness();
    core.observe("h", u([], []));
    core.observe("h", u([], ["B"])); // B finishes → mark raised
    expect(cleared).toEqual([]);
    core.observe("h", u([], [])); // B back to work → mark cleared
    expect(cleared).toEqual([{ host: "h", id: "B" }]);
  });

  it("an ASKING terminal that goes back to work clears its unread mark", () => {
    const { core, cleared } = harness();
    core.observe("h", u([], []));
    core.observe("h", u(["B"], [])); // B asks → mark raised
    core.observe("h", u([], [])); // B back to work → mark cleared
    expect(cleared).toEqual([{ host: "h", id: "B" }]);
  });

  it("an escalation finished→asking does NOT clear the mark (still needs you)", () => {
    const { core, cleared } = harness();
    core.observe("h", u([], []));
    core.observe("h", u([], ["B"])); // B finishes
    core.observe("h", u(["B"], [])); // B escalates to asking — still in class
    expect(cleared).toEqual([]);
  });

  it("the baseline frame never clears (a discovery is not a transition)", () => {
    const { core, cleared } = harness();
    core.observe("h", u(["A"], ["B"])); // first frame per host
    expect(cleared).toEqual([]);
  });

  it("clears on the host the mark was SET on, not the one in view", () => {
    // Host-addressed: `isActiveHost` is false for this host throughout, and the
    // clear still names it — a background host's resume must reach its own mark.
    const { core, cleared } = harness({ isActiveHost: () => false });
    core.observe("other", u([], []));
    core.observe("other", u([], ["B"]));
    core.observe("other", u([], []));
    expect(cleared).toEqual([{ host: "other", id: "B" }]);
  });
});

describe("attentionCore — a tab that stays open through a redeploy", () => {
  // While padi is replaced, the mirror feeds the engine nothing (an unsettled
  // frame is not a report, `useAttentionFacts`), so the engine sees a settled
  // frame, then silence, then the fresh padi's first settled frame.

  it("the same frame after the silence rings nothing and drops no mark", () => {
    const { core, delivered, cleared } = harness();
    core.observe("h", u([], []));
    core.observe("h", u(["Q"], ["A"]));
    expect(delivered).toHaveLength(2);
    // …padi goes away and comes back, having found both as they were.
    core.observe("h", u(["Q"], ["A"]));
    expect(delivered).toHaveLength(2);
    expect(cleared).toEqual([]);
  });

  it("a terminal that finished while padi was away rings once, loud", () => {
    const { core, delivered, quiet } = harness();
    core.observe("h", u([], []));
    core.observe("h", u([], ["B"]));
    expect(delivered).toEqual([{ id: "B", asking: false }]);
    expect(quiet).toEqual([]);
  });
});

describe("attentionCore — a page loaded after kolu restarted, resumed from what it saved", () => {
  /** What this browser saved before the restart: the last frame, and the
   *  terminals already announced (latched) — by default, every one in it. */
  const saved = (
    asking: string[],
    finished: string[],
    latched: string[] = [...asking, ...finished],
  ): AttentionMemory => ({
    frame: u(asking, finished),
    latched: latched as TerminalId[],
    unseenFinished: [],
  });

  it("the same lists as saved: nothing rings, and no mark drops", () => {
    const { core, delivered, cleared } = harness({
      resume: () => saved(["Q"], ["A"]),
    });
    core.observe("h", u(["Q"], ["A"]));
    expect(delivered).toEqual([]);
    expect(cleared).toEqual([]);
  });

  it("a terminal that finished while kolu was down is marked, without a sound", () => {
    const { core, delivered, quiet } = harness({
      resume: () => saved([], ["A"]),
    });
    core.observe("h", u([], ["A", "B"]));
    expect(delivered).toEqual([{ id: "B", asking: false }]);
    expect(quiet).toEqual(["B"]);
  });

  it("a terminal that went back to work, quit or closed while kolu was down loses its mark", () => {
    const { core, cleared, delivered } = harness({
      resume: () => saved([], ["A", "B"]),
    });
    core.observe("h", u([], ["A"]));
    expect(cleared).toEqual([{ host: "h", id: "B" }]);
    expect(delivered).toEqual([]);
  });

  it("an announced terminal that is still finished does not ring again on the next change", () => {
    // The latch came back with the frame: a later frame that moves something
    // else must not re-announce A.
    const { core, delivered } = harness({ resume: () => saved([], ["A"]) });
    core.observe("h", u([], ["A"]));
    core.observe("h", u(["Q"], ["A"]));
    expect(delivered).toEqual([{ id: "Q", asking: true }]);
  });

  it("only the first frame is resumed — a finish after it rings as always", () => {
    const { core, delivered, quiet } = harness({
      resume: () => saved([], []),
    });
    core.observe("h", u([], []));
    core.observe("h", u([], ["A"]));
    expect(delivered).toEqual([{ id: "A", asking: false }]);
    expect(quiet).toEqual([]);
  });

  it("with nothing saved, the first frame is a baseline, as it always was", () => {
    const { core, delivered, cleared } = harness();
    core.observe("h", u(["Q"], ["A"]));
    expect(delivered).toEqual([]);
    expect(cleared).toEqual([]);
  });

  it("hands its memory back after each frame, so the next page can resume from it", () => {
    const { core, remembered } = harness();
    core.observe("h", u([], []));
    core.observe("h", u(["Q"], ["A"]));
    expect(remembered.at(-1)).toEqual({
      host: "h",
      memory: {
        frame: u(["Q"], ["A"]),
        latched: ["Q", "A"],
        unseenFinished: [],
      },
    });
  });

  it("a finish on a host you are not looking at stays unseen across the reload", () => {
    const before = harness({ isActiveHost: () => false });
    before.core.observe("h", u([], []));
    before.core.observe("h", u([], ["A"]));
    const memory = before.remembered.at(-1)?.memory ?? null;
    expect(memory?.unseenFinished).toEqual(["A"]);
    // The page reloads; the host tab's quiet dot comes back with it.
    const marks: number[] = [];
    const after = harness({
      isActiveHost: () => false,
      resume: () => memory,
      writeMark: (_h, n) => marks.push(n),
    });
    after.core.observe("h", u([], ["A"]));
    expect(marks).toEqual([1]);
    expect(after.delivered).toEqual([]);
  });
});
