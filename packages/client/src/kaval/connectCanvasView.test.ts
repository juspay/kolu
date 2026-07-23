/** The connect overlay's DATA-presence visibility rules (W6 — kill the silent probing
 *  window): the tail + elapsed render off the frame's own data, never a per-phase flag. */

import type { ConnectionInfo } from "kolu-common/surfacesWithPadi";
import { describe, expect, it } from "vitest";
import { showsElapsed, tailOf } from "./connectCanvasView.ts";

/** A `probing` frame that already carries the warm-probe narration nixCopy logs at probe
 *  start — the exact line the silent window used to hide. */
const probingFrame: ConnectionInfo = {
  phase: "probing",
  log: [{ source: "local", line: "zest: checking for a cached agent…" }],
  sinceMs: 2_000,
  campaignEpoch: 0,
};

describe("tailOf — the live log tail renders off frame data, not a flag", () => {
  it("a probing frame whose log carries the checking line renders the tail", () => {
    // The bug: `probing` was `showProgress:false`, so this line was hidden — a silent wait.
    // Now the tail renders whenever the log is non-empty, so the probe narrates immediately.
    const tail = tailOf(probingFrame.log);
    expect(tail).toHaveLength(1);
    expect(tail[0]?.line).toContain("checking for a cached agent");
  });

  it("the gap (no frame → empty log) renders title-only by construction", () => {
    expect(tailOf([])).toHaveLength(0);
  });

  it("keeps only the last TAIL_LINES lines", () => {
    const many = Array.from({ length: 20 }, (_, i) => ({
      source: "remote" as const,
      line: `line ${i}`,
    }));
    expect(tailOf(many)).toHaveLength(6);
    expect(tailOf(many).at(-1)?.line).toBe("line 19");
  });
});

describe("showsElapsed — the ≥1s guard (no 0s flash)", () => {
  it("renders elapsed once the duration reaches 1s (a dragging connect reads abnormal)", () => {
    expect(showsElapsed(2_000)).toBe(true);
    expect(showsElapsed(1_000)).toBe(true);
  });

  it("suppresses a sub-1s elapsed — the brief handshake never flashes a 0s", () => {
    expect(showsElapsed(500)).toBe(false);
    expect(showsElapsed(0)).toBe(false);
  });

  it("suppresses the pre-frame gap (elapsedMs null)", () => {
    expect(showsElapsed(null)).toBe(false);
  });
});
