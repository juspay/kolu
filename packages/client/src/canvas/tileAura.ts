/** Canvas state-aura tier — the dispatch the canvas tile's border glow
 *  (Language A · Halo) emits. Pure function of `(bucket, unread, stale)` so
 *  the rule is independently testable without spinning up a Solid render
 *  harness, exactly the way the dock's `pipVariant` is. Order matters:
 *  `unread` dominates the bucket — a tile that fired an alert in the
 *  background still reads "alert" even if its agent has since moved on,
 *  because the unread obligation outlives the bucket transition until the
 *  user focuses the tile (which clears unread).
 *
 *  Reuses the dock's upstream classifiers (`agentBucket`, the unread flag,
 *  `useStaleCheck`) but maps to the canvas's own vocabulary: a ranked, aging
 *  ladder where a fresh waiter outranks a busy tile and a stale waiter cools
 *  *below* it. A stale worker parks to `none`, so the canvas agrees with the
 *  dock's `parked` bucket rather than advertising a hum on a quieted tile. */

import type { AgentBucketKind } from "./dockModel";

export type TileAura =
  | "alert" // unread: a fresh, missed "needs you" — fast throb, loudest
  | "waiting-fresh" // awaiting + recent — gentle violet breathe
  | "working" // thinking / tools / background — steady rust hum, no motion
  | "waiting-stale" // awaiting but aged past the activity window — dim ember
  | "none"; // idle / parked / no agent — no glow

export function tileAura(
  bucket: Exclude<AgentBucketKind, "idle">,
  unread: boolean,
  stale: boolean,
): TileAura {
  if (unread) return "alert";
  if (bucket === "awaiting") return stale ? "waiting-stale" : "waiting-fresh";
  if (bucket === "working") return stale ? "none" : "working";
  return "none";
}
