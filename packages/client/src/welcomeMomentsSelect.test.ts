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

  it("pinned + reachable: next-tier moments (agents · host · shortcuts)", () => {
    expect(
      selectWelcomeMoments({
        pinDone: true,
        reachDone: true,
        hostsDone: false,
      }),
    ).toEqual({
      done: ["pin", "reach"],
      rows: ["agents", "host", "shortcuts"],
    });
  });

  it("all collapse-able done: agents + shortcuts only", () => {
    expect(
      selectWelcomeMoments({
        pinDone: true,
        reachDone: true,
        hostsDone: true,
      }),
    ).toEqual({
      done: ["pin", "reach", "host"],
      rows: ["agents", "shortcuts"],
    });
  });

  it("only pin done: reach · agents · host (pin in header)", () => {
    expect(
      selectWelcomeMoments({
        pinDone: true,
        reachDone: false,
        hostsDone: false,
      }),
    ).toEqual({
      done: ["pin"],
      rows: ["reach", "agents", "host"],
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
