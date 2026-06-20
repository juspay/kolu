/** State-pip render variant — the dispatch the dock's `StatePip` JSX
 *  emits. Pure function of `(bucket, unread)` so the rule is
 *  independently testable without spinning up a Solid render harness;
 *  extracted from `RowPips.tsx` precisely so the unit test can import
 *  it without dragging the Solid runtime in. Order matters: `unread`
 *  dominates the bucket — a row that just fired an alert in the
 *  background still reads as "attention" even if the agent has since
 *  transitioned to working, because the unread obligation outlives
 *  the bucket transition until the user activates the row. */

import type { DockRowBucket } from "./dockRowRanking";

export type PipVariant =
  | "attention" // unread: loud filled disk + halo + pulse
  | "awaiting" // bucket awaiting, !unread: quiet dim dot (lingering)
  | "working" // hollow spinning ring
  | "idle" // muted small dot
  | "sleeping" // frozen tile — moon glyph
  | "empty"; // parked / none — render nothing

/** Pure A→B bucket-to-pip mapping. TypeScript's required-property check
 *  on `Record<DockRowBucket, …>` enforces exhaustiveness — adding a new
 *  bucket variant to `DockRowBucket` causes a compile error here. */
const BUCKET_TO_PIP: Record<DockRowBucket, PipVariant> = {
  awaiting: "awaiting",
  working: "working",
  idle: "idle",
  parked: "empty",
  sleeping: "sleeping",
  none: "empty",
};

export function pipVariant(bucket: DockRowBucket, unread: boolean): PipVariant {
  // A sleeping tile reads as asleep even if it had a lingering unread when it
  // was put down — the moon wins, there's no live agent to attend to.
  if (bucket === "sleeping") return "sleeping";
  if (unread) return "attention";
  return BUCKET_TO_PIP[bucket];
}
