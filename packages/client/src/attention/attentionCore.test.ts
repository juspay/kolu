/** Coverage for the detect→fire engine — the path `__koluSimulateAlert` (and so
 *  e2e) bypasses. Reproduces the reported deploy bug: a background terminal that
 *  FINISHES must fire an alert. */

import type { PadiUrgency } from "@kolu/padi/surface";
import type { TerminalId } from "kolu-common/surface";
import { describe, expect, it, vi } from "vitest";
import { type AttentionHooks, createAttentionCore } from "./attentionCore";

const u = (awaiting: string[] = [], finished: string[] = []): PadiUrgency => ({
  awaitingIds: awaiting as TerminalId[],
  finishedIds: finished as TerminalId[],
});

function harness(over: Partial<AttentionHooks> = {}) {
  const delivered: Array<{ id: string; asking: boolean }> = [];
  const hooks: AttentionHooks = {
    alertsEnabled: () => true,
    isActiveHost: () => true,
    isWatched: () => false, // nothing watched by default (background)
    deliver: (_h, id, asking) => delivered.push({ id, asking }),
    writeMark: () => {},
    ...over,
  };
  return { core: createAttentionCore(hooks), delivered };
}

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
    const frame = u([], []); // ONE object, reused + mutated (reconcile)
    core.observe("h", frame); // baseline
    frame.finishedIds = ["B"] as TerminalId[]; // mutate in place
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
});
