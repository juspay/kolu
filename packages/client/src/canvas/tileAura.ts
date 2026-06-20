/** Canvas state-aura tier — the dispatch the canvas tile's border glow
 *  (Language C · Run / sweep) emits. Pure function of `(bucket, unread, stale)` so
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
  | "alert" // unread: a fresh, missed "needs you" — fastest, brightest sweep, loudest
  | "waiting-fresh" // awaiting + recent — a steady repo-color comet sweeps the ring
  | "working" // thinking / tools / background — runs as marching ants; busy, asks nothing
  | "waiting-stale" // awaiting but aged past the activity window — same comet, slowed and dimmed
  | "sleeping" // PTY-released, frozen — a STATIC moonlit ring, keyed purely on state==="sleeping", decoupled from staleness/bucket (resolved by useTileAura before the live fold, never produced by tileAura())
  | "none"; // idle / parked / no agent — no glow

export function tileAura(
  bucket: Exclude<AgentBucketKind, "idle">,
  unread: boolean,
  stale: boolean,
): TileAura {
  if (unread) return "alert";
  switch (bucket) {
    case "awaiting":
      return stale ? "waiting-stale" : "waiting-fresh";
    case "working":
      return stale ? "none" : "working";
    case "none":
      return "none";
    default: {
      // Exhaustiveness fence: if `AgentBucketKind` gains another live bucket,
      // this stops compiling until the new state is mapped to a tier rather
      // than silently rendering no aura.
      const _exhaustive: never = bucket;
      return _exhaustive;
    }
  }
}
