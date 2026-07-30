/** The one rule deciding whether an attach snapshot may be painted into this
 *  pane: does it answer the grid the pane actually has?
 *
 *  A serialized screen is bytes laid out FOR a specific cols×rows — cursor moves
 *  and wraps only mean anything at the width they were written for. The pane
 *  asks for a snapshot at the grid it measured, but the answer can arrive after
 *  that grid has moved: a resize while the request is in flight, and a
 *  STREAM_RETRY, which re-subscribes by replaying the ORIGINAL captured input.
 *
 *  Extracted so the rule is stated once and tested directly. Terminal.tsx
 *  consults it at BOTH moments that matter — when the frame is received, and
 *  again when the bytes have actually PARSED (`h.write` is asynchronous, and
 *  scroll lock can stash a chunk until the user unlocks, an unbounded delay in
 *  which the pane can still resize). */

/** A cols×rows this pane measured, or `null` when there is none to compare. */
export interface SnapshotGrid {
  cols: number;
  rows: number;
}

/** `accept` — paint it and seed backfill from it. `reopen` — do neither; the
 *  snapshot describes a layout this pane no longer has, so it must be refused
 *  and a fresh one requested at the current grid. */
export type SnapshotVerdict = "accept" | "reopen";

/**
 * Judge a snapshot answered for `requested` against the pane's `current` grid.
 *
 * An absent side yields `accept`: with nothing to compare there is no evidence
 * of a mismatch, and refusing on ignorance would livelock the reopen loop rather
 * than protect anything. The reachable absences are both benign — no request has
 * been made yet, or the pane has been disposed and its grid released.
 */
export function judgeSnapshotGrid(
  requested: SnapshotGrid | null,
  current: SnapshotGrid | null,
): SnapshotVerdict {
  if (!requested || !current) return "accept";
  return requested.cols === current.cols && requested.rows === current.rows
    ? "accept"
    : "reopen";
}
