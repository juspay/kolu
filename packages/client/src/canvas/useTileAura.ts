/** Reactive receptacle around `tileAura` — turns a terminal id into the full
 *  per-tile classification both canvas surfaces need. Closes over the terminal
 *  store and ONE `useStaleCheck()` instance, then gathers the agent bucket,
 *  unread flag, and staleness band in one place so the canvas tile
 *  (`TerminalCanvas`) and the minimap marker (`CanvasMinimap`) both plug into a
 *  single socket instead of hand-wiring the same three classifiers. It projects
 *  its gathered inputs to many consumers — returning `{ aura, bucket, stale }`
 *  so `TerminalCanvas` can derive `dimmed` and `CanvasMinimap` can derive
 *  `parked` + `data-bucket` off the same read, rather than each re-running
 *  `agentBucket`/`useStaleCheck` per surface. The pure `tileAura` core stays in
 *  `tileAura.ts` (unit-tested without a Solid render harness); this is the
 *  reactive wiring that hides it — kept in its own module so the pure core
 *  never has to import the store/wire graph. */

import type { TerminalId } from "kolu-common/surface";
import { useStaleCheck } from "../terminal/staleness";
import { useTerminalStore } from "../terminal/useTerminalStore";
import { type AgentBucketKind, agentBucket } from "./dockModel";
import { type TileAura, tileAura } from "./tileAura";

/** The per-tile classification both canvas surfaces project from one gather:
 *  the aura tier, plus the underlying bucket + staleness bit so consumers
 *  don't re-derive them past the receptacle. */
export interface TileAuraState {
  aura: TileAura;
  bucket: Exclude<AgentBucketKind, "idle">;
  stale: boolean;
}

export function useTileAura(): (id: TerminalId) => TileAuraState {
  const store = useTerminalStore();
  const isStale = useStaleCheck();
  return (id) => {
    const meta = store.getMetadata(id);
    const bucket = agentBucket(meta?.agent);
    const stale = isStale(meta?.lastActivityAt ?? 0);
    return { aura: tileAura(bucket, store.isUnread(id), stale), bucket, stale };
  };
}
