import { describe, expect, it } from "vitest";
import { shouldEmitActivityEdge } from "./ptyHost.ts";

const THROTTLE = 200;

describe("shouldEmitActivityEdge", () => {
  it("emits for fresh output with no resize window open", () => {
    expect(shouldEmitActivityEdge(1000, false, 0)).toBe(true);
  });

  it("EXCLUDES output while a resize window is open (the SIGWINCH repaint)", () => {
    expect(shouldEmitActivityEdge(1050, true, 0)).toBe(false);
  });

  it("resumes emitting once the resize window has closed", () => {
    expect(shouldEmitActivityEdge(1600, false, 0)).toBe(true);
  });

  it("the window wins even when the throttle would otherwise allow it", () => {
    expect(shouldEmitActivityEdge(5000, true, 0)).toBe(false);
  });

  it("throttle-coalesces bursts within the window", () => {
    expect(shouldEmitActivityEdge(1000, false, 1000 - (THROTTLE - 1))).toBe(
      false,
    );
    expect(shouldEmitActivityEdge(1000, false, 1000 - THROTTLE)).toBe(true);
  });
});
