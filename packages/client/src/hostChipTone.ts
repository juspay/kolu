/**
 * The host chip's connection-dot tone + hover title, derived from the keyed map's
 * projected `EntryStatus`. Pure (no JSX, no `wire`), so `HostSelectorStrip.tsx` renders
 * with them and the unit pin imports them without dragging in the live transport.
 */

import type { EntryStatus } from "@kolu/surface-map";

/** The connection dot's tailwind tone. Green (`bg-emerald-400`) is emitted ONLY for
 *  `connected` — fact-only, the same discipline `<HostStatusPip>` enforces for a
 *  surface's `health()`. A map entry's equivalent fact is its `EntryStatus`, which
 *  `connectSurfaceMap` floors on real transport liveness, so a green-over-a-dead-host
 *  dot is unrenderable. */
export function dotClass(
  status: EntryStatus | { kind: "not-a-member" },
): string {
  switch (status.kind) {
    case "connected":
      return "bg-emerald-400"; // live — the map floors this on transport liveness
    case "warming":
      return "bg-amber-400"; // copying / connecting / pre-clock-offset — coming up
    case "failed":
      return "bg-red-400"; // provisioning or link failed
    default:
      return "bg-fg-3/40"; // not-a-member (unreached — we only render members)
  }
}

/** A one-line human note for the dot's `title` — the failure reason when failed. */
export function statusTitle(
  status: EntryStatus | { kind: "not-a-member" },
): string {
  switch (status.kind) {
    case "connected":
      return "connected";
    case "warming":
      return "connecting…";
    case "failed":
      return `failed: ${status.reason}`;
    default:
      return "not a member";
  }
}
