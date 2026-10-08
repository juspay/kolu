import { createRoot, createSignal } from "solid-js";
import { describe, expect, it } from "vitest";
import { latchKnown, selectWelcomeMoments } from "./welcomeMomentsSelect";

describe("selectWelcomeMoments", () => {
  it("fresh install: the agents choice is the first row, the header empty", () => {
    expect(
      selectWelcomeMoments({
        chooseAgentsDone: false,
        pinDone: false,
        reachDone: false,
        hostsDone: false,
      }),
    ).toEqual({
      done: [],
      rows: ["chooseAgents", "pin", "reach"],
    });
  });

  it("the agents choice stays first while undone, whatever else is done", () => {
    expect(
      selectWelcomeMoments({
        chooseAgentsDone: false,
        pinDone: true,
        reachDone: true,
        hostsDone: true,
      }),
    ).toEqual({
      done: ["pin", "reach", "host"],
      rows: ["chooseAgents", "agents", "search"],
    });
  });

  it("before the stored choice is known: neither a row nor in the header", () => {
    expect(
      selectWelcomeMoments({
        chooseAgentsDone: undefined,
        pinDone: true,
        reachDone: false,
        hostsDone: false,
      }),
    ).toEqual({
      done: ["pin"],
      rows: ["reach", "agents", "search"],
    });
  });

  it("agents chosen, nothing else done: the choice in the header, then the first three", () => {
    expect(
      selectWelcomeMoments({
        chooseAgentsDone: true,
        pinDone: false,
        reachDone: false,
        hostsDone: false,
      }),
    ).toEqual({
      done: ["chooseAgents"],
      rows: ["pin", "reach", "agents"],
    });
  });

  it("pinned + reachable: next-tier moments (agents · search · host)", () => {
    expect(
      selectWelcomeMoments({
        chooseAgentsDone: true,
        pinDone: true,
        reachDone: true,
        hostsDone: false,
      }),
    ).toEqual({
      done: ["chooseAgents", "pin", "reach"],
      rows: ["agents", "search", "host"],
    });
  });

  it("all collapse-able done: agents · search · shortcuts", () => {
    expect(
      selectWelcomeMoments({
        chooseAgentsDone: true,
        pinDone: true,
        reachDone: true,
        hostsDone: true,
      }),
    ).toEqual({
      done: ["chooseAgents", "pin", "reach", "host"],
      rows: ["agents", "search", "shortcuts"],
    });
  });

  it("only pin done: reach · agents · search (pin in header)", () => {
    expect(
      selectWelcomeMoments({
        chooseAgentsDone: true,
        pinDone: true,
        reachDone: false,
        hostsDone: false,
      }),
    ).toEqual({
      done: ["chooseAgents", "pin"],
      rows: ["reach", "agents", "search"],
    });
  });

  it("only hosts done: pin · reach · agents (host in header)", () => {
    expect(
      selectWelcomeMoments({
        chooseAgentsDone: true,
        pinDone: false,
        reachDone: false,
        hostsDone: true,
      }),
    ).toEqual({
      done: ["chooseAgents", "host"],
      rows: ["pin", "reach", "agents"],
    });
  });
});

describe("latchKnown — the first-run flag keeps its last known reading", () => {
  /** Run `steps` against a latch over a settable reading; return what the
   *  latch read after each. */
  function trail(steps: readonly (boolean | undefined)[]) {
    return createRoot((dispose) => {
      const [reading, setReading] = createSignal<boolean | undefined>();
      const latched = latchKnown(reading);
      const seen = [latched()];
      for (const step of steps) {
        setReading(() => step);
        seen.push(latched());
      }
      dispose();
      return seen;
    });
  }

  it("a fresh load knows nothing until a reading arrives (no reload flash)", () => {
    expect(trail([undefined, true])).toEqual([undefined, undefined, true]);
  });

  it("a pick that this machine has not caught up with keeps the row", () => {
    // not done → picked, padi still `off` (not known) → downloading → ready.
    expect(trail([false, undefined, false, true])).toEqual([
      undefined,
      false,
      false,
      false,
      true,
    ]);
  });

  it("a known reading always replaces the last one", () => {
    expect(trail([true, undefined, false])).toEqual([
      undefined,
      true,
      true,
      false,
    ]);
  });
});
