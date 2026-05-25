/** Dock row ranking — pure bucket-classifier + recency-sort over the
 *  live-terminal id list.
 *
 *  All consumers reach this function through `useDockOrder()` (the
 *  desktop `Dock`, `MobileDockDrawer`, and `App.tsx`'s `dockOrderedIds`
 *  feeding `Cmd+1..9` all read the same singleton output). That seam
 *  enforces structurally what this comment used to ask for as a
 *  convention: the visual row order and the row a numeric shortcut
 *  activates can't disagree, because there is exactly one derivation
 *  pipeline. Direct callers of `rankDockRows` bypass `useDockOrder` and
 *  lose access to the tree projection that the dock actually renders —
 *  reach for the singleton unless you have a specific reason to ignore
 *  the tree layer (e.g. unit tests of this module).
 *
 *  Kept separate from `dockModel.ts`: that module uses a four-bucket
 *  scheme (`awaiting/working/idle/none`) that the canvas minimap also
 *  reads, while dock rows use a five-bucket scheme with `parked` as
 *  its own visual treatment. Co-locating the two enums in one file
 *  would invite label-collision bugs. */

import type { TerminalId, TerminalMetadata } from "kolu-common/surface";
import { agentBucket } from "../dockModel";

/** Per-row render variant. `parked` is its own bucket (not folded into
 *  idle) because it carries a different visual treatment (faded, tinier
 *  row) and routes through staleness, not the idle-bucket classifier. */
export type DockRowBucket = "awaiting" | "working" | "idle" | "parked" | "none";

/** Sort priority for rows that share `lastActivityAt` (most commonly
 *  several plain shells at `ts === 0`). Lower comes first. */
const DOCK_ROW_BUCKET_PRIORITY: Record<DockRowBucket, number> = {
  awaiting: 0,
  working: 1,
  idle: 2,
  parked: 3,
  none: 4,
};

function classifyDockRow(
  meta: TerminalMetadata,
  parked: boolean,
): DockRowBucket {
  if (parked) return "parked";
  const agent = agentBucket(meta.agent);
  // A terminal that *has* an agent but no live attention state reads
  // as "idle" in the dock — quieter than a working pill. Plain shells
  // (`lastActivityAt === 0`) route to `none`.
  if (agent === "none") return meta.lastActivityAt > 0 ? "idle" : "none";
  return agent;
}

export type RankedDockRow = {
  id: TerminalId;
  bucket: DockRowBucket;
  ts: number;
};

/** Project a terminal id list into the recency-sorted, bucket-classified
 *  row order the dock paints. Secondary key is bucket priority so
 *  never-touched plain shells don't outrank an idle terminal with the
 *  same `ts === 0`. `isStale` is a pure-temporal predicate over
 *  `lastActivityAt` — identity for stale-but-still-awaiting agents lives
 *  at the render layer (`QuietRowBody` paints `AgentIndicator` when
 *  `meta.agent` is set), not in the bucket decision here. */
export function rankDockRows(
  ids: readonly TerminalId[],
  getMeta: (id: TerminalId) => TerminalMetadata | undefined,
  isStale: (lastActivityAt: number) => boolean,
): RankedDockRow[] {
  const rows: RankedDockRow[] = [];
  for (const id of ids) {
    const meta = getMeta(id);
    if (!meta) continue;
    const bucket = classifyDockRow(meta, isStale(meta.lastActivityAt));
    rows.push({ id, bucket, ts: meta.lastActivityAt });
  }
  rows.sort((a, b) => {
    if (a.ts !== b.ts) return b.ts - a.ts;
    return (
      DOCK_ROW_BUCKET_PRIORITY[a.bucket] - DOCK_ROW_BUCKET_PRIORITY[b.bucket]
    );
  });
  return rows;
}
