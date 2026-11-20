import type { AgentBucketKind } from "./dockModel";

export type TileAura =
  | "alert"
  | "waiting-fresh"
  | "working"
  | "waiting-stale"
  | "finished"
  | "none";

export function tileAura(
  bucket: Exclude<AgentBucketKind, "idle">,
  unread: boolean,
  stale: boolean,
): TileAura {
  if (unread) return "alert";
  switch (bucket) {
    case "awaiting":
      return stale ? "waiting-stale" : "waiting-fresh";
    case "linger":
      return stale ? "none" : "finished";
    case "working":
      return stale ? "none" : "working";
    case "none":
      return "none";
    default: {
      const _exhaustive: never = bucket;
      return _exhaustive;
    }
  }
}
