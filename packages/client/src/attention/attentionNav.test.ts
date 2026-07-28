/** The jump seam's two laws: one owner, and clicks that WALK the set.
 *
 *  Both are things you would otherwise only discover from behaviour — a second
 *  owner silently winning, or a capsule that bounces on the first blocked agent
 *  and never reaches the rest. */

import { afterEach, describe, expect, it, vi } from "vitest";
import { jumpToAsking, registerAttentionJump } from "./attentionNav";

let dispose: (() => void) | null = null;
afterEach(() => {
  dispose?.();
  dispose = null;
});

describe("registerAttentionJump", () => {
  it("routes a jump to the registered owner", () => {
    const jump = vi.fn();
    dispose = registerAttentionJump(jump);
    jumpToAsking("host-a");
    expect(jump).toHaveBeenCalledWith("host-a");
  });

  it("refuses a second owner rather than letting the last one silently win", () => {
    dispose = registerAttentionJump(() => {});
    expect(() => registerAttentionJump(() => {})).toThrow(
      /exactly one attention owner/,
    );
  });

  it("throws on a click that arrives before any owner mounted", () => {
    expect(() => jumpToAsking("host-a")).toThrow(/before useAttention/);
  });

  it("frees the slot on teardown, so the next owner can take it", () => {
    registerAttentionJump(() => {})();
    const second = vi.fn();
    dispose = registerAttentionJump(second);
    jumpToAsking("host-b");
    expect(second).toHaveBeenCalledWith("host-b");
  });
});
