import { describe, expect, it } from "vitest";
import { selectWelcomeMoments } from "./welcomeMomentsSelect";

describe("selectWelcomeMoments", () => {
  it("fresh install: first three moments, empty header", () => {
    expect(
      selectWelcomeMoments({
        pinDone: false,
        reachDone: false,
        hostsDone: false,
      }),
    ).toEqual({
      done: [],
      rows: ["pin", "reach", "agents"],
    });
  });

  it("pinned + reachable: next-tier moments (agents · search · host)", () => {
    expect(
      selectWelcomeMoments({
        pinDone: true,
        reachDone: true,
        hostsDone: false,
      }),
    ).toEqual({
      done: ["pin", "reach"],
      rows: ["agents", "search", "host"],
    });
  });

  it("all collapse-able done: agents · search · shortcuts", () => {
    expect(
      selectWelcomeMoments({
        pinDone: true,
        reachDone: true,
        hostsDone: true,
      }),
    ).toEqual({
      done: ["pin", "reach", "host"],
      rows: ["agents", "search", "shortcuts"],
    });
  });

  it("only pin done: reach · agents · search (pin in header)", () => {
    expect(
      selectWelcomeMoments({
        pinDone: true,
        reachDone: false,
        hostsDone: false,
      }),
    ).toEqual({
      done: ["pin"],
      rows: ["reach", "agents", "search"],
    });
  });

  it("only hosts done: pin · reach · agents (host in header)", () => {
    expect(
      selectWelcomeMoments({
        pinDone: false,
        reachDone: false,
        hostsDone: true,
      }),
    ).toEqual({
      done: ["host"],
      rows: ["pin", "reach", "agents"],
    });
  });
});
