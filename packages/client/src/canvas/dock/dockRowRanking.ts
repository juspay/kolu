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
 *  so the dock ranks a given agent state identically to every `agentProjection`
 *  consumer (one source, pinned by the dock ⇄ agentProjection parity test).
 *  The dock then layers its OWN overlays on top: `sleeping` (a deliberate
 *  dormant state), `parked` (the staleness window), and `none` (a
 *  never-touched plain shell) — the quieter tail below the three shared
 *  buckets. `dockModel.ts`'s `paintBucket` is the orthogonal PAINT fold (tile
 *  aura / minimap / switcher columns / title pip), kept separate so the two
 *  enums can't collide. */

import {
  activeArm,
  sleepingArm,
  type TerminalMetadata,
} from "@kolu/padi/surface";
import {
  type AgentPaintClass,
  agentBucket,
  agentPaintClass,
  agentUrgency,
  type TerminalId,
  URGENCY_RANK,
} from "kolu-common/surface";

/** Per-row render variant. Declared as an EXTENSION of the shared
 *  `AgentPaintClass` (awaiting | working | none) plus the dock's own triage tail,
 *  so `DockRowBucket` CONTAINS `AgentPaintClass` by declaration — the paint class
 *  the row pip and the tile title both feed into `StatePip` is then a declared
 *  subset of this union, not a literal coincidence. `parked` is its own bucket
 *  (not folded into idle) because it carries a different visual treatment (faded,
 *  tinier row) and routes through staleness, not the idle-bucket classifier.
 *  `sleeping` is its own bucket for the fresh-within-window case — a freshly-slept
 *  tile reads "asleep" with its ☾ row. But staleness wins over it: once a slept
 *  tile's last activity falls outside the window it routes to `parked` and is
 *  dropped, so the activity-window selector compresses old dormant tiles too. */
export type DockRowBucket =
  | AgentPaintClass
  | "blocked"
  | "idle"
  | "sleeping"
  | "parked";

/** Tiebreak ordering for rows with equal `ts` (typically never-touched
 *  shells whose `lastActivityAt === null`). Pure-recency sort dominates
 *  everywhere else; this table only decides the order of rows that
 *  carry no recency signal at all, so the result stays deterministic.
 *  Lower number = shown first. The three agent-state buckets inherit the
 *  shared needs-you-first rank (`need=0 < work=1 < idle=2`) so the dock can't
 *  drift from the shared `agentProjection` ordering; `sleeping`/`parked`/`none`
 *  are the dock's own quieter tail below them. */
export const DOCK_ROW_BUCKET_PRIORITY: Record<DockRowBucket, number> = {
  // `blocked` is a PIP (colour) bucket only — the ORDER fold (`classifyDockRow`,
  // via `agentUrgency`) never emits it, ranking a blocked agent as `awaiting`
  // (`need`). It shares that rank here so the total `Record` stays honest.
  blocked: URGENCY_RANK.need,
  awaiting: URGENCY_RANK.need,
  working: URGENCY_RANK.work,
  idle: URGENCY_RANK.idle,
  sleeping: 3,
  parked: 4,
  none: 5,
};

/** The row-overlay precedence shared by BOTH folds (order and paint): parked
 *  wins over sleeping. Parked is checked FIRST because a sleeping tile is still
 *  subject to the activity window — a *fresh* slept tile keeps its ☾ row, but
 *  once its last activity falls outside the window it routes to `parked` (which
 *  `dockTree` hides) like any other stale row, otherwise yesterday's dormant
 *  terminals pile up in the dock and the window selector can't compress them.
 *  Lifting the precedence here means it lives at ONE site: the order and paint
 *  folds call this before diverging into their agent-state tails, so a future
 *  reorder can't desync the two. */
function dockOverlayBucket(
  meta: TerminalMetadata,
  parked: boolean,
): "parked" | "sleeping" | undefined {
  if (parked) return "parked";
  if (sleepingArm(meta)) return "sleeping";
  return undefined;
}

function classifyDockRow(
  meta: TerminalMetadata,
  parked: boolean,
): DockRowBucket {
  const overlay = dockOverlayBucket(meta, parked);
  if (overlay) return overlay;
  // The agent-state core IS the shared needs-you projection, so the dock ranks
  // a given state identically to every `agentProjection` consumer (pinned by the
  // parity test). `awaiting_user` → need, the working states → work, and
  // everything else — a `waiting` post-turn agent, an unknown state, or no
  // agent at all — → idle. A never-touched plain shell (`lastActivityAt === 0`,
  // no agent) keeps its quieter `none` bucket below idle.
  switch (agentUrgency(activeArm(meta)?.agent)) {
    case "need":
      return "awaiting";
    case "work":
      return "working";
    case "idle":
      return meta.lastActivityAt !== null ? "idle" : "none";
  }
}

/** The PIP bucket a row paints — separate from the ORDER bucket above so a row's
 *  pip COLOUR is decided once and reads identically across the dock row and the
 *  tile title (both render through `StatePip`). For a live-agent row a
 *  genuinely-blocked `awaiting_user` agent paints the loud `blocked` core, and
 *  every other state folds through the shared `agentPaintClass` — so a fresh
 *  `waiting` agent paints the dim lingering `awaiting` dot, even though
 *  `classifyDockRow` ranks it `idle` for ORDERING. `TerminalMeta` makes the SAME
 *  `blocked` promotion for its title pip (`agentPipVariant`), so the two agree.
 *  The dock-only triage buckets that have no agent to paint — `sleeping` (☾),
 *  `parked` (hidden) and the never-touched `none`/`idle` shells — keep the order
 *  bucket, since the title shows no pip for them at all (it gates on a live
 *  agent). Order (rank) and colour (paint) are thus decoupled: the row sorts by
 *  urgency but glows by paint. */
function paintDockRow(meta: TerminalMetadata, parked: boolean): DockRowBucket {
  // The overlay also runs in the paint fold so the two folds stay aligned by
  // construction — even though a parked pip never paints (`dockTree` drops the
  // row before it can reach a pip).
  const overlay = dockOverlayBucket(meta, parked);
  if (overlay) return overlay;
  const agent = activeArm(meta)?.agent;
  // No live agent → no pip colour to share with the title; keep the order
  // bucket's plain-shell triage (`idle` if touched, else `none`).
  if (!agent) return meta.lastActivityAt !== null ? "idle" : "none";
  // A genuinely-blocked agent (`awaiting_user`) paints the LOUD `blocked` core —
  // it's asking you right now. `waiting` (the post-turn lull) stays the dim
  // lingering `awaiting` dot below. `agentBucket` is the shared fence that already
  // separates the two (`awaiting_user`→"awaiting", `waiting`→"waiting"), so this
  // reads it rather than a hand-rolled state check — the SAME promotion the tile
  // title makes in `agentPipVariant` (parity pinned by the ranking test).
  if (agentBucket(agent.state) === "awaiting") return "blocked";
  const paint = agentPaintClass(agent.state);
  // An unknown state paints `none`; surface it as `idle` (a quiet dot) when the
  // row has activity rather than an empty cell, matching the order fold.
  return paint === "none" && meta.lastActivityAt !== null ? "idle" : paint;
}

export type RankedDockRow = {
  id: TerminalId;
  /** The ORDER bucket — drives sort priority (`DOCK_ROW_BUCKET_PRIORITY`) and
   *  the `data-bucket` attribute / rail-glow. Reads `agentUrgency`, so `waiting`
   *  is `idle` here (it does not float into the needs-you order). */
  bucket: DockRowBucket;
  /** The PIP bucket — drives the row's `StatePip` colour, decoupled from order
   *  so it reads identically to the tile title's pip. A genuinely-blocked
   *  `awaiting_user` agent is `blocked` (loud); a fresh `waiting` agent is the
   *  dim `awaiting` (it keeps its lingering glow). */
  pip: DockRowBucket;
  ts: number | null;
};

/** The recency timestamp the dock keys a row on — WHEN YOU PUT IT TO SLEEP
 *  (`sleptAt`) for a sleeping tile, else its last agent transition
 *  (`lastActivityAt`, honest `null` for a never-active shell — see
 *  `AgentMemorySchema`). A sleeping tile's recency is the deliberate, recent
 *  sleep action, not its stale agent clock: `sleptAt` is always ≥
 *  `lastActivityAt` (you sleep a terminal after its agent last moved), so
 *  keying the activity window on `lastActivityAt` instead would (a) never park
 *  a plain shell slept long ago — `isStale` exempts `lastActivityAt === null`,
 *  so an agent-less dormant tile would pile up forever — and (b) instantly
 *  drop a JUST-slept tile whose agent last transitioned outside the window,
 *  contradicting "a freshly-slept one still shows with its ☾".
 *
 *  This is the ONE source for that derivation: `rankDockRows` feeds it to the
 *  window predicate AND the sort key, and the row's `RecencyCell` displays it,
 *  so the "Xs ago" a row shows is the exact age the window acts on — a 4h
 *  window never hides a row that reads "1h ago" or keeps one that reads "3d
 *  ago". `null` (never-active, never-slept) passes through honestly — the
 *  sort below ranks it last rather than forging a fake epoch. */
export function rowRecencyAt(meta: TerminalMetadata): number | null {
  return sleepingArm(meta)?.sleptAt ?? meta.lastActivityAt;
}

/** `ts`'s sort rank for a most-recent-first order — `null` (never-active)
 *  sorts LAST, mirroring `agentProjection.ts`'s `recencyRank`. Exported so
 *  `dockTree.ts`'s cluster/group/row recency sorts share the SAME null
 *  handling rather than re-deriving it. */
export function tsRank(ts: number | null): number {
  return ts ?? Number.NEGATIVE_INFINITY;
}

/** Project a terminal id list into the recency-sorted, bucket-classified
 *  row order the dock paints. Secondary key is bucket priority so
 *  never-touched plain shells don't outrank an idle terminal with the
 *  same `ts === null`. `isStale` is a pure-temporal predicate over a recency
 *  timestamp — `rowRecencyAt` (`lastActivityAt` for an active tile, `sleptAt`
 *  for a sleeping one). Identity for stale-but-still-awaiting agents lives at
 *  the render layer (`QuietRowBody` paints `AgentIndicator` when `meta.agent`
 *  is set), not in the bucket decision here. */
export function rankDockRows(
  ids: readonly TerminalId[],
  getMeta: (id: TerminalId) => TerminalMetadata | undefined,
  isStale: (lastActivityAt: number | null) => boolean,
): RankedDockRow[] {
  const rows: RankedDockRow[] = [];
  for (const id of ids) {
    const meta = getMeta(id);
    if (!meta) continue;
    const recencyAt = rowRecencyAt(meta);
    const parked = isStale(recencyAt);
    const bucket = classifyDockRow(meta, parked);
    const pip = paintDockRow(meta, parked);
    rows.push({ id, bucket, pip, ts: recencyAt });
  }
  rows.sort((a, b) => {
    if (a.ts !== b.ts) return tsRank(b.ts) - tsRank(a.ts);
    return (
      DOCK_ROW_BUCKET_PRIORITY[a.bucket] - DOCK_ROW_BUCKET_PRIORITY[b.bucket]
    );
  });
  return rows;
}
