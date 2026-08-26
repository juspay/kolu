/** The `terminalAttach` consumer contract, pinned.
 *
 *  These are not spot-checks of a three-line predicate. Each case is a shape
 *  that cost a production incident, and the reason the rule ships with the
 *  stream rather than with whichever app learned it. */

import { describe, expect, it } from "vitest";
import { isSnapshotFrame, snapshotAnswersGrid } from "./attach.ts";

const G = (cols: number, rows: number) => ({ cols, rows });

describe("snapshotAnswersGrid", () => {
  it("accepts a snapshot that answers the grid it was asked at", () => {
    expect(snapshotAnswersGrid(G(80, 24), G(80, 24))).toBe(true);
  });

  // The 66→65 column settle that blanked three panes at once.
  it("refuses a snapshot answering a grid the pane no longer has", () => {
    expect(snapshotAnswersGrid(G(66, 24), G(65, 24))).toBe(false);
    expect(snapshotAnswersGrid(G(80, 24), G(80, 25))).toBe(false);
  });

  // BOTH absences answer. Refusing on ignorance livelocks the reopen loop
  // against a pane that is not there — which is how this predicate's own error
  // path failed when it was first written to refuse.
  it("accepts when either side is unmeasured — ignorance is not evidence", () => {
    for (const absent of [null, undefined]) {
      expect(snapshotAnswersGrid(absent, G(80, 24))).toBe(true);
      expect(snapshotAnswersGrid(G(80, 24), absent)).toBe(true);
      expect(snapshotAnswersGrid(absent, absent)).toBe(true);
    }
  });

  // The clause no consumer guesses: `resizeTo` is last-attach-wins on a SHARED
  // pty, so another client attaching at its own size stales this snapshot with
  // no local event to observe. The predicate cannot see that happen — which is
  // exactly why it must be asked on EVERY snapshot, not only after our own
  // resizes. This case is that asymmetry, stated as a test.
  it("catches a foreign resize the same way it catches a local one", () => {
    const askedAt = G(120, 40);
    // Nothing local changed; a phone attached at 80x24 and the pty followed it.
    expect(snapshotAnswersGrid(askedAt, G(80, 24))).toBe(false);
  });
});

describe("isSnapshotFrame", () => {
  it("narrows on the discriminant, not on the presence of topLine", () => {
    const snapshot = { kind: "snapshot", data: "x", topLine: 0 } as const;
    const delta = { kind: "delta", data: "x" } as const;
    expect(isSnapshotFrame(snapshot)).toBe(true);
    expect(isSnapshotFrame(delta)).toBe(false);
    // A delta carries no layout claim, so it is never stale — the whole reason
    // the check is scoped to the snapshot arm.
    if (isSnapshotFrame(snapshot)) expect(snapshot.topLine).toBe(0);
  });
});
