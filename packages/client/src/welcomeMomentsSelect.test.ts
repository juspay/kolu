import { describe, expect, it } from "vitest";
import { selectWelcomeMoments } from "./welcomeMomentsSelect";

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
