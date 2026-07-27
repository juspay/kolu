import { describe, expect, it } from "vitest";
import { pipMotionKind } from "./pipMotion";

describe("pipMotionKind", () => {
  it("working always spins", () => {
    expect(pipMotionKind({ variant: "working", active: true })).toBe("spin");
  });

  it("needs-you (awaiting variant) always glows", () => {
    expect(pipMotionKind({ variant: "awaiting", active: true })).toBe("glow");
  });

  it("linger (post-turn waiting) spins while active, still when finished", () => {
    expect(pipMotionKind({ variant: "linger", active: true })).toBe("spin");
    expect(pipMotionKind({ variant: "linger", active: false })).toBe("none");
  });

  it("shell idles still, spins when active", () => {
    expect(pipMotionKind({ variant: "idle", active: false })).toBe("none");
    expect(pipMotionKind({ variant: "idle", active: true })).toBe("spin");
  });

  it("agentless working paint only spins while active", () => {
    expect(pipMotionKind({ variant: "working", active: false })).toBe("none");
    expect(pipMotionKind({ variant: "working", active: true })).toBe("spin");
  });

  it("sleeping / empty never move", () => {
    expect(pipMotionKind({ variant: "sleeping", active: true })).toBe("none");
    expect(pipMotionKind({ variant: "empty", active: true })).toBe("none");
  });
});
