/** Dock row ranking — the single source for "what live terminals does
 *  the dock show, in what order".
 *
 *  Desktop `Dock.tsx`, the touch `DockList.tsx`, and the `Cmd+1..9`
 *  keyboard shortcut all read the same `rankDockRows` output, so the
 *  visual row order and the row that a numeric shortcut activates can
 *  never disagree. Without this single source the Alt-held hint chips
 *  can lie about which terminal `Cmd+N` targets — the dock paints rows
 *  with parked terminals dimmed and pushed down, but a parallel
 *  pure-recency derivation in `ActionContext.dockOrderedIds` would
 *  send the keystroke to whichever terminal had the most recent
 *  `lastActivityAt` regardless of its dock position.
 *
 *  The agent-state core — awaiting/working/idle and their needs-you-first
 *  rank — is the shared `agentProjection` (`agentUrgency` · `URGENCY_RANK`),
 *  so the dock ranks a given agent state identically to pulam-tui and
 *  pulam-web (one source, pinned by the cross-consumer differential test).
 *  The dock then layers its OWN overlays on top: `sleeping` (a deliberate
 *  dormant state), `parked` (the staleness window), and `none` (a
 *  never-touched plain shell) — the quieter tail below the three shared
 *  buckets. `dockModel.ts`'s `paintBucket` is the orthogonal PAINT fold (tile
 *  aura / minimap / switcher columns / title pip), kept separate so the two
 *  enums can't collide. */

import {
  activeArm,
  agentPaintClass,
  type AgentPaintClass,
  agentUrgency,
  sleepingArm,
  type TerminalId,
  type TerminalMetadata,
  URGENCY_RANK,
} from "kolu-common/surface";

/** Per-row render variant. Declared as an EXTENSION of the shared
 *  `AgentPaintClass` (awaiting | working | none) plus the dock's own triage tail,
 *  so `DockRowBucket` CONTAINS `AgentPaintClass` by declaration — the paint class
 *  the row pip and the tile title both feed into `StatePip` is then a declared
 *  subset of this union, not a literal coincidence. `parked` is its own bucket
 *  (not folded into idle) because it carries a different visual treatment (faded,
 *  tinier row) and routes through staleness, not the idle-bucket classifier.
 *  `sleeping` is likewise its own bucket — a DELIBERATE dormant state, decoupled
 *  from staleness: a freshly-slept tile must read "asleep", never "parked", and
 *  must NOT be dropped by the dock's parked filter. */
export type DockRowBucket = AgentPaintClass | "idle" | "sleeping" | "parked";

/** Tiebreak ordering for rows with equal `ts` (typically never-touched
 *  shells whose `lastActivityAt === 0`). Pure-recency sort dominates
 *  everywhere else; this table only decides the order of rows that
 *  carry no recency signal at all, so the result stays deterministic.
 *  Lower number = shown first. The three agent-state buckets inherit the
 *  shared needs-you-first rank (`need=0 < work=1 < idle=2`) so the dock can't
 *  drift from the pulam-tui / pulam-web ordering; `sleeping`/`parked`/`none`
 *  are the dock's own quieter tail below them. */
export const DOCK_ROW_BUCKET_PRIORITY: Record<DockRowBucket, number> = {
  awaiting: URGENCY_RANK.need,
  working: URGENCY_RANK.work,
  idle: URGENCY_RANK.idle,
  sleeping: 3,
  parked: 4,
  none: 5,
};

function classifyDockRow(
  meta: TerminalMetadata,
  parked: boolean,
): DockRowBucket {
  // Sleeping is checked FIRST, before parked: a sleeping tile is a deliberate
  // dormant state, never staleness, so it must keep its ☾ row and never fall
  // into the parked-drop (which `dockTree` hides) however long it has slept.
  if (sleepingArm(meta)) return "sleeping";
  if (parked) return "parked";
  // The agent-state core IS the shared needs-you projection, so the dock ranks
  // a given state identically to pulam-tui / pulam-web (pinned by the
  // differential test). `awaiting_user` → need, the working states → work, and
  // everything else — a `waiting` post-turn agent, an unknown state, or no
  // agent at all — → idle. A never-touched plain shell (`lastActivityAt === 0`,
  // no agent) keeps its quieter `none` bucket below idle.
  switch (agentUrgency(activeArm(meta)?.agent)) {
    case "need":
      return "awaiting";
    case "work":
      return "working";
    case "idle":
      return meta.lastActivityAt > 0 ? "idle" : "none";
  }
}

/** The PIP bucket a row paints — separate from the ORDER bucket above so a row's
 *  pip COLOUR is decided once and reads identically across the dock row and the
 *  tile title (both render through `StatePip`). For a live-agent row it is the
 *  shared `agentPaintClass` — the SAME fold `TerminalMeta` feeds its title pip —
 *  so a fresh `waiting` agent paints `awaiting` (the lingering dim-alert dot) in
 *  BOTH places, even though `classifyDockRow` ranks it `idle` for ORDERING. The
 *  dock-only triage buckets that have no agent to paint — `sleeping` (☾),
 *  `parked` (hidden) and the never-touched `none`/`idle` shells — keep the order
 *  bucket, since the title shows no pip for them at all (it gates on a live
 *  agent). Order (rank) and colour (paint) are thus decoupled: the row sorts by
 *  urgency but glows by paint. */
function paintDockRow(meta: TerminalMetadata, parked: boolean): DockRowBucket {
  if (sleepingArm(meta)) return "sleeping";
  if (parked) return "parked";
  const agent = activeArm(meta)?.agent;
  // No live agent → no pip colour to share with the title; keep the order
  // bucket's plain-shell triage (`idle` if touched, else `none`).
  if (!agent) return meta.lastActivityAt > 0 ? "idle" : "none";
  const paint = agentPaintClass(agent.state);
  // An unknown state paints `none`; surface it as `idle` (a quiet dot) when the
  // row has activity rather than an empty cell, matching the order fold.
  return paint === "none" && meta.lastActivityAt > 0 ? "idle" : paint;
}

export type RankedDockRow = {
  id: TerminalId;
  /** The ORDER bucket — drives sort priority (`DOCK_ROW_BUCKET_PRIORITY`) and
   *  the `data-bucket` attribute / rail-glow. Reads `agentUrgency`, so `waiting`
   *  is `idle` here (it does not float into the needs-you order). */
  bucket: DockRowBucket;
  /** The PIP bucket — drives the row's `StatePip` colour, decoupled from order
   *  so it reads identically to the tile title's pip. Reads `agentPaintClass`,
   *  so a fresh `waiting` agent is `awaiting` here (it keeps its glow). */
  pip: DockRowBucket;
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
    const parked = isStale(meta.lastActivityAt);
    const bucket = classifyDockRow(meta, parked);
    const pip = paintDockRow(meta, parked);
    rows.push({ id, bucket, pip, ts: meta.lastActivityAt });
  }
  rows.sort((a, b) => {
    if (a.ts !== b.ts) return b.ts - a.ts;
    return (
      DOCK_ROW_BUCKET_PRIORITY[a.bucket] - DOCK_ROW_BUCKET_PRIORITY[b.bucket]
    );
  });
  return rows;
}
