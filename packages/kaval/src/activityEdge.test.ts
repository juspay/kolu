/**
 * The meaningful-output edge gate — the cursor-only + resize exclusions and the
 * throttle that decide whether an output chunk publishes an activity edge. Pure,
 * so the load-bearing
 * "a resize repaint is not activity" rule (the reveal/resize un-finish regression's
 * root fix) is pinned without a real PTY or a wall clock.
 */

import { describe, expect, it } from "vitest";
import { shouldEmitActivityEdge } from "./ptyHost.ts";

const THROTTLE = 200; // ACTIVITY_EDGE_THROTTLE_MS
const OUT = "hello\r\n";

describe("shouldEmitActivityEdge", () => {
  it("emits for fresh output outside any mute window", () => {
    expect(shouldEmitActivityEdge(OUT, 1000, 0, 0)).toBe(true);
  });

  it("EXCLUDES output inside the resize-mute window (the SIGWINCH repaint)", () => {
    // A resize at t=1000 muted until 1600; the repaint lands at 1050 → excluded.
    expect(shouldEmitActivityEdge(OUT, 1050, 1600, 0)).toBe(false);
  });

  it("resumes emitting once the resize-mute window has passed", () => {
    expect(shouldEmitActivityEdge(OUT, 1600, 1600, 0)).toBe(true);
  });

  it("mute wins even when the throttle would otherwise allow it", () => {
    // Long since the last edge (throttle satisfied) but still inside the mute.
    expect(shouldEmitActivityEdge(OUT, 1050, 1600, 0)).toBe(false);
  });

  it("throttle-coalesces bursts within the window", () => {
    expect(shouldEmitActivityEdge(OUT, 1000, 0, 1000 - (THROTTLE - 1))).toBe(
      false,
    );
    expect(shouldEmitActivityEdge(OUT, 1000, 0, 1000 - THROTTLE)).toBe(true);
  });

  it("EXCLUDES a cursor-only repaint (an idle TUI's frame loop)", () => {
    // Xyne CLI's idle frame, verbatim: it parks the cursor and changes no cell.
    // Counting it kept padi's finish-quiet window open forever — the dock pip
    // spun long after Xyne stopped responding.
    const idleFrame =
      "\x1b[?2026h\x1b[?25l\x1b[0m\x1b[36;6H\x1b[?25h\x1b[?2026l";
    expect(shouldEmitActivityEdge(idleFrame, 1000, 0, 0)).toBe(false);
  });
});
