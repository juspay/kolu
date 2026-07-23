import type { AgentInfo } from "kolu-common/surface";
import { describe, expect, it } from "vitest";
import { pipIsActive, pipMotionKind } from "./pipMotion";

function agent(state: AgentInfo["state"]): AgentInfo {
  return { kind: "claude-code", state } as AgentInfo;
}

describe("pipIsActive", () => {
  // RecencyCell uses this same predicate to hide "Xs ago" on active rows —
  // active ⇒ "just now" by definition, so the label is noise. Keep the rule
  // here so a recency show/hide change is forced to re-think the motion fold.
  it("shell is active only while live (also gates recency hide)", () => {
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

  // Sticky EF2 finish must not silence motion when the terminal is still
  // printing (#1955). finishedIds is the chime question; isLive is motion.
  it("sticky-finished waiting agent with live output is active", () => {
    const waitingAgent = agent("waiting");
    expect(
      pipIsActive({
        agent: waitingAgent,
        isLive: true,
        isFinished: true,
      }),
    ).toBe(true);
    expect(
      pipMotionKind({
        variant: "awaiting",
        agent: waitingAgent,
        active: true,
      }),
    ).toBe("spin");
    expect(
      pipIsActive({
        agent: waitingAgent,
        isLive: false,
        isFinished: true,
      }),
    ).toBe(false);
  });
});

describe("pipMotionKind", () => {
  it("working always spins", () => {
    expect(
      pipMotionKind({
        variant: "working",
        agent: agent("thinking"),
        active: true,
      }),
    ).toBe("spin");
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

  it("waiting spins while active, still when finished", () => {
    expect(
      pipMotionKind({
        variant: "awaiting",
        agent: agent("waiting"),
        active: true,
      }),
    ).toBe("spin");
    expect(
      pipMotionKind({
        variant: "awaiting",
        agent: agent("waiting"),
        active: false,
      }),
    ).toBe("none");
  });

  it("shell idles still, spins when active", () => {
    expect(pipMotionKind({ variant: "idle", agent: null, active: false })).toBe(
      "none",
    );
    expect(pipMotionKind({ variant: "idle", agent: null, active: true })).toBe(
      "spin",
    );
  });

  it("agentless working paint only spins while active", () => {
    expect(
      pipMotionKind({ variant: "working", agent: null, active: false }),
    ).toBe("none");
    expect(
      pipMotionKind({ variant: "working", agent: null, active: true }),
    ).toBe("spin");
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
