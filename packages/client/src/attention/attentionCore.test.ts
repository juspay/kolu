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
