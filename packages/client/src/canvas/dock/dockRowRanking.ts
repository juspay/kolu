/** Dock row ranking — the single source for "what live terminals does the dock
 *  show, and how is each one classified".
 *
 *  It owns the row SET (which terminals earn a row, and each row's order bucket,
 *  paint bucket and recency key) and the two ordering ingredients every dock
 *  surface shares: `DOCK_ROW_BUCKET_PRIORITY` and `tsRank`. It does NOT own the
 *  final painted order of top-level rows: `dockTree.ts` re-sorts them
 *  blocked-first (`compareRows`, layered on THIS module's priority table) after
 *  clustering them by branch, so the recency-first order `rankDockRows` returns
 *  is a baseline the tree refines — not the sequence on screen. Sub-entries
 *  (`rankSubTree`) keep this module's order all the way to the pixel.
 *
 *  Desktop `Dock.tsx`, the touch `DockList.tsx`, and the `Cmd+1..9`
 *  keyboard shortcut all read the same rows, through the same tree, so the
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
  type AttentionClass,
  agentUrgency,
  paintClassOf,
  type TerminalId,
  URGENCY_RANK,
} from "kolu-common/surface";
import { match, P } from "ts-pattern";
import type { PaneNode } from "../../terminal/terminalTree";

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

/** Values the ORDER fold can actually emit. `linger` is paint-only. */
type DockOrderBucket = Exclude<DockRowBucket, "linger">;

/** Values the PAINT fold can actually emit. A classless row paints `idle`. */
type DockPaintBucket = Exclude<DockRowBucket, "none">;

/** A split shares its parent's window fate, so it cannot independently park. */
type SubDockOrderBucket = Exclude<DockOrderBucket, "parked">;
type SubDockPaintBucket = Exclude<DockPaintBucket, "parked">;

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
  parked: false,
): SubDockOrderBucket;
function classifyDockRow(
  meta: TerminalMetadata,
  parked: boolean,
): DockOrderBucket;
function classifyDockRow(
  meta: TerminalMetadata,
  parked: boolean,
): DockOrderBucket {
  const overlay = dockOverlayBucket(meta, parked);
  if (overlay) return overlay;
  // The agent-state core IS the shared needs-you projection, so the dock ranks
  // a given state identically to every `agentProjection` consumer (pinned by the
  // parity test). `awaiting_user` → need, the working states → work, and
  // everything else — a `waiting` post-turn agent, an unknown state, or no
  // agent at all — → idle. A never-touched plain shell (no agent, no recency)
  // keeps its quieter `none` bucket below idle.
  const agent = activeArm(meta)?.agent;
  switch (agentUrgency(agent)) {
    case "need":
      return "awaiting";
    case "work":
      return "working";
    case "idle":
      // `none` means a never-touched PLAIN SHELL, so the agent test is part of
      // the rule — not just the recency clock. A terminal that HAS an agent is
      // never that, whatever its clock says, and the two facts arrive on
      // separate padi writes: the composed record carries a fresh agent before
      // `lastActivityAt` is stamped. Reading recency alone put that frame's row
      // in `none`, a bucket `rankSubRow` asserts an agent split cannot reach —
      // and the throw escapes the dock's memo, taking the whole Dock down.
      if (agent) return "idle";
      return meta.lastActivityAt !== null ? "idle" : "none";
  }
}

/** The PIP bucket a row paints — separate from the ORDER bucket above so a row's
 *  pip COLOUR is decided once and reads identically across the dock row and the
 *  tile title (both render through `StatePip`).
 *
 *  It paints the terminal's ATTENTION CLASS — the same value its motion, its
 *  wash and every count read — never a class re-derived from the terminal's own
 *  metadata; the two-subscriptions argument for that is stated once in
 *  `attention/attentionFacts.ts`'s header. Colour was the last channel still
 *  believing the metadata, which is why it is spelled out here.
 *
 *  A quiet host therefore paints quiet: if the frame has not arrived, every
 *  mark reads idle rather than confidently colouring from a fact no count
 *  agrees with. That is the honest reading, and it is the same fact the host
 *  tab already shows by dimming.
 *
 *  A fresh `waiting` agent paints `linger` (the lingering dim-alert) even
 *  though `classifyDockRow` ranks it `idle` for ORDERING — order≠colour, still
 *  deliberately. Dock-only triage: `sleeping` / `parked` come off the metadata
 *  overlay, which is where they live. `parked` defaults false for non-windowed
 *  surfaces (title/switcher). */
export function paintDockRow(
  meta: TerminalMetadata,
  klass: AttentionClass,
): SubDockPaintBucket;
export function paintDockRow(
  meta: TerminalMetadata,
  klass: AttentionClass,
  parked: false,
): SubDockPaintBucket;
export function paintDockRow(
  meta: TerminalMetadata,
  klass: AttentionClass,
  parked: boolean,
): DockPaintBucket;
export function paintDockRow(
  meta: TerminalMetadata,
  klass: AttentionClass,
  parked: boolean = false,
): DockPaintBucket {
  // The overlay also runs in the paint fold so the two folds stay aligned by
  // construction — even though a parked pip never paints (`dockTree` drops the
  // row before it can reach a pip). Dormancy is a property of the TILE, not of
  // any agent inside it, so it stays a metadata read.
  const overlay = dockOverlayBucket(meta, parked);
  if (overlay) return overlay;
  // The class→paint rename is the vocabulary's `paintClassOf`, never restated
  // here: this switch used to spell the same five arms with the same four
  // answers, which is precisely the "two switches that happen to match" the
  // fenced vocabulary exists to prevent — a sixth class would have had to be
  // decided twice, and the copies could agree only by luck.
  const paint = paintClassOf(klass);
  // The ONE arm the dock diverges on. `none` is the vocabulary's absent class
  // (no glow at all), but every dock row core is an identity mark (Option C):
  // `PIP_BODY.empty` would swallow the shell's identity glyph, so a classless
  // row paints the quiet `idle` body instead of nothing.
  return paint === "none" ? "idle" : paint;
}

/** The neutral projection shared by every dock row. */
type DockRowCore = {
  id: TerminalId;
  /** The ORDER bucket — read through `DOCK_ROW_BUCKET_PRIORITY` by BOTH sorts
   *  that touch a row: this module's `ts`-tiebreak below, and `dockTree.ts`'s
   *  blocked-first leg for top-level rows. Also the `data-bucket` attribute /
   *  rail-glow. Reads `agentUrgency`, so `waiting` is `idle` here (it does not
   *  float into the needs-you order). */
  bucket: DockOrderBucket;
  /** The PIP bucket — drives the row's `StatePip` colour, decoupled from order
   *  so it reads identically to the tile title's pip. Reads the terminal's
   *  ATTENTION CLASS (the same value its motion and every count read), so a
   *  fresh `waiting` agent is `linger` here — it keeps a dim glow while the
   *  ORDER bucket ranks it idle. */
  pip: DockPaintBucket;
  ts: number | null;
};

/** A split's entry. Splits DO nest — a split of a split is a real parent→child
 * edge — so the entry carries its `depth` instead of its own `subRows`: the
 * whole subtree arrives as ONE depth-first sequence on the tile's row (see
 * `rankSubTree`), because the dock paints sub-entries as flat siblings of their
 * section and reads nesting off the indent. A nested `subRows` would have made
 * every consumer (rail entries, section attention, blocked-first) re-walk a
 * tree to answer "which splits are in this tile", and the ones that forgot
 * would silently miss depth ≥ 2 — which is exactly how the grandchild
 * disappeared from the Dock after the canvas flattened (#2059).
 * The type is deliberately private: consumers receive it only through its
 * parent's `subRows`, keeping the hierarchy as one validated product.
 * `pip` lives on the core (same as a top-level row): every sub-row surface
 * consumes the shared StatePip fold. `kind` only tags which order-bucket arm is
 * valid (shell vs agent) — never whether a pip fact exists, and never whether
 * the id joins section attention (every sub-row does; the fold decides legs).
 * Paint is `SubDockPaintBucket` (never `parked`) — a split shares its parent's
 * window fate, so the never-park invariant is structural on order AND paint. */
type SubDockRowCore = Omit<DockRowCore, "bucket" | "pip"> & {
  pip: SubDockPaintBucket;
  /** Hops from the tile's top-level row: 1 for a direct split, 2 for a split
   *  of that split, and so on. The row's indent — the only place the true tree
   *  is visible, since the DOM keeps every sub-entry a flat sibling. */
  depth: number;
};

type ShellSubDockOrderBucket = Extract<
  SubDockOrderBucket,
  "idle" | "none" | "sleeping"
>;
type AgentSubDockOrderBucket = Exclude<SubDockOrderBucket, "none" | "sleeping">;

/** Kind tags the order-bucket arm once while ranking. Paint/pip/unread ride the
 * shared fold on every surface — never re-gated by kind at the render site. */
type SubDockRow =
  | (SubDockRowCore & {
      kind: "shell";
      bucket: ShellSubDockOrderBucket;
    })
  | (SubDockRowCore & {
      kind: "agent";
      bucket: AgentSubDockOrderBucket;
    });

export type RankedDockRow = DockRowCore & {
  /** Every split inside this tile — at ANY depth — as an indented dock
   *  sub-entry, in depth-first order (each split immediately followed by its
   *  own splits). Every sub-entry carries the same paint pip fact a top-level
   *  row does — identity glyph, motion, unread — so shell and agent sub-rows
   *  cannot drift. */
  subRows: readonly SubDockRow[];
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

/** Project a terminal id list into the recency-sorted, bucket-classified rows
 *  the dock renders — the BASELINE order (`dockTree.ts` clusters and re-sorts
 *  top-level rows blocked-first on top of it; see the module header). Secondary
 *  key is bucket priority so never-touched plain shells don't outrank an idle
 *  terminal with the same `ts === null`. `isStale` is a pure-temporal predicate
 *  over the newest recency in the whole tile: the parent's `rowRecencyAt` or
 *  any DESCENDANT split's. A split shares its parent's window fate, so its
 *  activity must keep that parent — and therefore every split landing —
 *  visible, at any depth. Identity
 *  for stale-but-still-awaiting agents lives at the render layer
 *  (`QuietRowBody` paints `AgentIndicator` when `meta.agent` is set), not in the
 *  bucket decision here.
 *
 *  `getPaneTree` is required: silently defaulting to no splits would erase the
 *  very rows this projection exists to surface. It is the STORE's pane index —
 *  the same one the canvas flattens into its tab strip — so the Dock and the
 *  canvas cover the same terminals by construction rather than by two walks
 *  that have to be kept in step. */
export function rankDockRows(
  ids: readonly TerminalId[],
  getMeta: (id: TerminalId) => TerminalMetadata | undefined,
  isStale: (lastActivityAt: number | null) => boolean,
  classOf: (id: TerminalId) => AttentionClass,
  getPaneTree: (tileId: TerminalId) => readonly PaneNode[],
): RankedDockRow[] {
  const rows: RankedDockRow[] = [];
  for (const id of ids) {
    const meta = getMeta(id);
    if (!meta) continue;
    const subRows = rankSubTree(getPaneTree(id), getMeta, classOf);
    let recencyAt = rowRecencyAt(meta);
    for (const sub of subRows) {
      if (tsRank(sub.ts) > tsRank(recencyAt)) recencyAt = sub.ts;
    }
    const parked = isStale(recencyAt);
    rows.push({
      id,
      bucket: classifyDockRow(meta, parked),
      pip: paintDockRow(meta, classOf(id), parked),
      ts: recencyAt,
      subRows,
    });
  }
  rows.sort(byRecencyThenBucket);
  return rows;
}

/** Fold the tile's pane TREE into its dock sub-entries: siblings ordered
 *  needs-you-first, each one immediately followed by its own splits, one level
 *  deeper. A grandchild is a real parent→child edge — the Dock keeps that true
 *  tree, where the canvas flattens the same panes into one tab strip (#2059).
 *
 *  The tree ARRIVES from the store (`getPaneTree`), the same index whose flat
 *  shape the canvas paints; this module only orders and classifies it. Ranking
 *  used to walk the raw one-hop parent edge itself and stopped at depth 1, so a
 *  split of a split had a canvas tab and no dock row at all — a live terminal
 *  the Dock could not reach. Consuming the shared index is what makes that
 *  unspellable here: there is no traversal left to under-walk, and cycles /
 *  orphans are already resolved once, identically for both surfaces. */
function rankSubTree(
  nodes: readonly PaneNode[],
  getMeta: (id: TerminalId) => TerminalMetadata | undefined,
  classOf: (id: TerminalId) => AttentionClass,
  depth = 1,
): SubDockRow[] {
  const siblings: Array<{ row: SubDockRow; children: readonly PaneNode[] }> =
    [];
  for (const node of nodes) {
    const row = rankSubRow(node.id, depth, getMeta, classOf);
    // IDs and projected metadata are independent reactive reads. Match the
    // top-level row contract above: reading a missing slot subscribes this memo
    // to its arrival, so omit the not-yet-paintable row for this frame; the
    // reactive recomputation includes it. Its own splits wait with it — an
    // entry indented under a row that isn't there reads as a lie.
    if (row) siblings.push({ row, children: node.children });
  }
  siblings.sort((a, b) => byBucketThenRecency(a.row, b.row));
  return siblings.flatMap(({ row, children }) => [
    row,
    ...rankSubTree(children, getMeta, classOf, depth + 1),
  ]);
}

/** One split's entry. A sub-entry shares its parent's activity window fate, so
 *  it is never independently parked. Agent urgency buckets the entry; an
 *  agentless split naturally falls into the quiet tail. */
function rankSubRow(
  id: TerminalId,
  depth: number,
  getMeta: (id: TerminalId) => TerminalMetadata | undefined,
  classOf: (id: TerminalId) => AttentionClass,
): SubDockRow | undefined {
  const meta = getMeta(id);
  if (!meta) return undefined;
  const bucket = classifyDockRow(meta, false);
  // Paint once here — the same fact DockRow / DockListRow / SubTerminalRow /
  // RailSubChip all hand to `useStatePip`. Never synthesize per-surface.
  const core = {
    id,
    depth,
    ts: rowRecencyAt(meta),
    pip: paintDockRow(meta, classOf(id), false),
  };
  const agent = activeArm(meta)?.agent;
  if (!agent) {
    return match(bucket)
      .with(P.union("idle", "none", "sleeping"), (shellBucket) => ({
        ...core,
        kind: "shell" as const,
        bucket: shellBucket,
      }))
      .with(P.union("awaiting", "working"), (invalidBucket) => {
        throw new Error(
          `rankDockRows: agentless split ${id} classified as ${invalidBucket}`,
        );
      })
      .exhaustive();
  }
  return match(bucket)
    .with(P.union("awaiting", "working", "idle"), (agentBucket) => ({
      ...core,
      kind: "agent" as const,
      bucket: agentBucket,
    }))
    .with(P.union("none", "sleeping"), (invalidBucket) => {
      throw new Error(
        `rankDockRows: agent split ${id} classified as ${invalidBucket}`,
      );
    })
    .exhaustive();
}

function byRecencyThenBucket(
  a: Pick<DockRowCore, "bucket" | "ts">,
  b: Pick<DockRowCore, "bucket" | "ts">,
): number {
  if (a.ts !== b.ts) return tsRank(b.ts) - tsRank(a.ts);
  return (
    DOCK_ROW_BUCKET_PRIORITY[a.bucket] - DOCK_ROW_BUCKET_PRIORITY[b.bucket]
  );
}

/** Needs-you first for sibling splits, then newest within the same urgency. */
function byBucketThenRecency(a: SubDockRow, b: SubDockRow): number {
  const urgency =
    DOCK_ROW_BUCKET_PRIORITY[a.bucket] - DOCK_ROW_BUCKET_PRIORITY[b.bucket];
  return urgency !== 0 ? urgency : tsRank(b.ts) - tsRank(a.ts);
}
