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
  agentPaintClass,
  agentUrgency,
  type TerminalId,
  URGENCY_RANK,
} from "kolu-common/surface";

/** Per-row render variant. Declared as an EXTENSION of the shared
 *  `AgentPaintClass` (awaiting | linger | working | none) plus the dock's own triage tail,
 *  so `DockRowBucket` CONTAINS `AgentPaintClass` by declaration — the paint class
 *  the row pip and the tile title both feed into `StatePip` is then a declared
 *  subset of this union, not a literal coincidence. `parked` is its own bucket
 *  (not folded into idle) because it carries a different visual treatment (faded,
 *  tinier row) and routes through staleness, not the idle-bucket classifier.
 *  `sleeping` is its own bucket for the fresh-within-window case — a freshly-slept
 *  tile reads "asleep" with its ☾ row. But staleness wins over it: once a slept
 *  tile's last activity falls outside the window it routes to `parked` and is
 *  dropped, so the activity-window selector compresses old dormant tiles too. */
export type DockRowBucket = AgentPaintClass | "idle" | "sleeping" | "parked";

/** Tiebreak ordering for rows with equal `ts` (typically never-touched
 *  shells whose `lastActivityAt === null`). Pure-recency sort dominates
 *  everywhere else; this table only decides the order of rows that
 *  carry no recency signal at all, so the result stays deterministic.
 *  Lower number = shown first. The three agent-state buckets inherit the
 *  shared needs-you-first rank (`need=0 < work=1 < idle=2`) so the dock can't
 *  drift from the shared `agentProjection` ordering; `sleeping`/`parked`/`none`
 *  are the dock's own quieter tail below them. */
export const DOCK_ROW_BUCKET_PRIORITY: Record<DockRowBucket, number> = {
  awaiting: URGENCY_RANK.need,
  working: URGENCY_RANK.work,
  // `linger` is a PAINT-only bucket (`classifyDockRow` never emits it — a
  // post-turn `waiting` agent ORDERS as idle), listed here only because the
  // priority table is total over the union; it ranks with idle, honestly.
  linger: URGENCY_RANK.idle,
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
 *  tile title (both render through `StatePip`). For a live-agent row it is the
 *  shared `agentPaintClass` — the SAME fold title / switcher use via
 *  `bindStatePip`. A fresh `waiting` agent paints `linger` (the lingering
 *  dim-alert) even though `classifyDockRow` ranks it `idle` for ORDERING.
 *  Dock-only triage: `sleeping` / `parked` / plain shells → idle paint (shell
 *  glyph) when order ranks `none`. `parked` defaults false for non-windowed
 *  surfaces (title/switcher). */
export function paintDockRow(
  meta: TerminalMetadata,
  parked: boolean = false,
): DockRowBucket {
  // The overlay also runs in the paint fold so the two folds stay aligned by
  // construction — even though a parked pip never paints (`dockTree` drops the
  // row before it can reach a pip).
  const overlay = dockOverlayBucket(meta, parked);
  if (overlay) return overlay;
  const agent = activeArm(meta)?.agent;
  // No live agent → shell identity glyph (`idle` paint: fg-3, still). Every
  // dock row core is an identity mark (Option C); never-touched shells still
  // ORDER as `none` via `classifyDockRow`, but they PAINT as idle so
  // `PIP_BODY.empty` does not swallow the shell glyph. `parked` stays empty
  // via the overlay above (and never reaches a visible row).
  if (!agent) return "idle";
  const paint = agentPaintClass(agent.state);
  // An unknown state paints `none`; surface it as `idle` (shell mark) when the
  // row has activity rather than an empty cell, matching the order fold.
  return paint === "none" && meta.lastActivityAt !== null ? "idle" : paint;
}

/** A split's entry — a row that cannot itself carry splits, because splits do
 *  not nest. The invariant lives in the TYPE rather than in a comment and a
 *  unit test: a recursive `subRows` made the illegal shape spellable, and every
 *  consumer's one-level flatten was then correct only by convention. */
export type SubDockRow = {
  id: TerminalId;
  /** The ORDER bucket — drives sort priority (`DOCK_ROW_BUCKET_PRIORITY`) and
   *  the `data-bucket` attribute / rail-glow. Reads `agentUrgency`, so `waiting`
   *  is `idle` here (it does not float into the needs-you order). */
  bucket: DockRowBucket;
  /** The PIP bucket — drives the row's `StatePip` colour, decoupled from order
   *  so it reads identically to the tile title's pip. Reads `agentPaintClass`,
   *  so a fresh `waiting` agent is `linger` here (it keeps a dim glow). */
  pip: DockRowBucket;
  ts: number | null;
};

export type RankedDockRow = SubDockRow & {
  /** Agents running in this terminal's SPLITS, as indented sub-entries.
   *
   *  A split is a whole second terminal that the dock had no row for, so an
   *  agent working in one was counted by its host's tab and visible nowhere in
   *  the dock — a tab reading 4 above three rows, with the fourth agent
   *  reachable only by clicking into the split. It gets a mark of its own now,
   *  indented under the terminal it lives in rather than promoted to a peer
   *  row: it IS subordinate, and flattening it would break the correspondence
   *  between a top-level row and a `Cmd+N` shortcut.
   *
   *  Only splits with an agent RENDER. A plain `bash` split is what the `⊟ N`
   *  chip already says, and giving every one a line would bury the signal this
   *  exists to surface. Empty for a terminal with no agent-bearing splits —
   *  which is nearly all of them. */
  subRows: readonly SubDockRow[];
  /** EVERY split's id, agent or not — what a scope COUNT quantifies over.
   *
   *  What gets a row and what gets counted are different questions, and folding
   *  them together left the two altitudes counting different populations: a
   *  host tab counts every terminal padi published, including a plain shell
   *  running a build in a split, so a section header folding `subRows` alone
   *  reported one fewer than the tab directly above it. Rendering stays
   *  agent-only; counting quantifies over all of them. */
  subIds: readonly TerminalId[];
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
  getSubIds: (parentId: TerminalId) => readonly TerminalId[] = () => [],
): RankedDockRow[] {
  const rows: RankedDockRow[] = [];
  for (const id of ids) {
    const meta = getMeta(id);
    if (!meta) continue;
    const recencyAt = rowRecencyAt(meta);
    const parked = isStale(recencyAt);
    const bucket = classifyDockRow(meta, parked);
    const pip = paintDockRow(meta, parked);
    const subIds = getSubIds(id);
    rows.push({
      id,
      bucket,
      pip,
      ts: recencyAt,
      subRows: rankSubRows(subIds, getMeta),
      subIds,
    });
  }
  rows.sort(byRecencyThenBucket);
  return rows;
}

/** Rank a terminal's SPLITS into the sub-entries its row carries, keeping only
 *  the ones running an agent.
 *
 *  Deliberately not filtered by the activity window: a sub-entry belongs to its
 *  parent row and shares its fate, so a split whose agent has been blocked for
 *  hours stays visible as long as the terminal holding it does. Ranking a split
 *  independently would let the dock hide the agent while still showing the
 *  terminal it is running in — the exact invisibility this feature exists to
 *  end. Sorted the same way peers are, so a blocked split leads its siblings. */
function rankSubRows(
  subIds: readonly TerminalId[],
  getMeta: (id: TerminalId) => TerminalMetadata | undefined,
): SubDockRow[] {
  const rows: SubDockRow[] = [];
  for (const id of subIds) {
    const meta = getMeta(id);
    if (!meta) continue;
    // No agent, no entry — the `⊟ N` chip already accounts for plain splits.
    if (!activeArm(meta)?.agent) continue;
    rows.push({
      id,
      bucket: classifyDockRow(meta, false),
      pip: paintDockRow(meta, false),
      ts: rowRecencyAt(meta),
    });
  }
  rows.sort(byRecencyThenBucket);
  return rows;
}

function byRecencyThenBucket(a: SubDockRow, b: SubDockRow): number {
  if (a.ts !== b.ts) return tsRank(b.ts) - tsRank(a.ts);
  return (
    DOCK_ROW_BUCKET_PRIORITY[a.bucket] - DOCK_ROW_BUCKET_PRIORITY[b.bucket]
  );
}
