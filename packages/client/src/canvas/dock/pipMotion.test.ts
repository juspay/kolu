import type { AgentInfo } from "kolu-common/surface";
import { describe, expect, it } from "vitest";
import { pipIsActive, pipMotionKind } from "./pipMotion";

function agent(state: AgentInfo["state"]): AgentInfo {
  return { kind: "claude-code", state } as AgentInfo;
}

describe("pipIsActive", () => {
  it("shell is active only while live", () => {
    expect(pipIsActive({ agent: null, isLive: true, isFinished: false })).toBe(
      true,
    );
    expect(pipIsActive({ agent: null, isLive: false, isFinished: false })).toBe(
      false,
    );
  });

  it("working is always active", () => {
    expect(
      pipIsActive({
        agent: agent("thinking"),
        isLive: false,
        isFinished: false,
      }),
    ).toBe(true);
  });

  it("awaiting_user is always active (glow channel)", () => {
    expect(
      pipIsActive({
        agent: agent("awaiting_user"),
        isLive: false,
        isFinished: false,
      }),
    ).toBe(true);
  });

  it("waiting is active until EF2 finished", () => {
    expect(
      pipIsActive({
        agent: agent("waiting"),
        isLive: false,
        isFinished: false,
      }),
    ).toBe(true);
    expect(
      pipIsActive({
        agent: agent("waiting"),
        isLive: false,
        isFinished: true,
      }),
    ).toBe(false);
  });
});

describe("pipMotionKind", () => {
  it("working always breathes", () => {
    expect(
      pipMotionKind({
        variant: "working",
        agent: agent("thinking"),
        active: true,
      }),
    ).toBe("breathe");
  });

  it("awaiting_user always glows", () => {
    expect(
      pipMotionKind({
        variant: "awaiting",
        agent: agent("awaiting_user"),
        active: true,
      }),
    ).toBe("glow");
  });

  it("waiting breathes while active, still when finished", () => {
    expect(
      pipMotionKind({
        variant: "awaiting",
        agent: agent("waiting"),
        active: true,
      }),
    ).toBe("breathe");
    expect(
      pipMotionKind({
        variant: "awaiting",
        agent: agent("waiting"),
        active: false,
      }),
    ).toBe("none");
  });

  it("shell idles still, breathes when active", () => {
    expect(pipMotionKind({ variant: "idle", agent: null, active: false })).toBe(
      "none",
    );
    expect(pipMotionKind({ variant: "idle", agent: null, active: true })).toBe(
      "breathe",
    );
  });

  it("sleeping / empty never move", () => {
    expect(
      pipMotionKind({
        variant: "sleeping",
        agent: null,
        active: true,
      }),
    ).toBe("none");
    expect(pipMotionKind({ variant: "empty", agent: null, active: true })).toBe(
      "none",
    );
  });
});
