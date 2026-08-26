/** **"Ranked" in this module's name is HISTORICAL — it classifies, in creation
 *  order, and sorts nothing.** `dockRowRanking.ts` / `rankDockRows` /
 *  `RankedDockRow` / `rankSubTree` kept their names through the #2141 change
 *  that deleted the dock's three sorts; read every "rank" below as "classify".
 *  Renaming them touches every dock surface at once, so it is a standing
 *  follow-up rather than a rider on the change that made the names stale.
 *
 *  Dock row classification — the single source for "what live terminals does
 *  the dock show, and how is each one classified".
 *
 *  It owns the row SET (which terminals earn a row, and each row's order
 *  bucket, paint bucket, attention flag and recency key) plus `tsRank`.
 *
 *  **It sorts nothing.** Rows come out in the order the ids arrived, which is
 *  padi's registry insertion order — the creation order `listTerminals` already
 *  contracts ("new terminals append to the tail; clients render this order
 *  directly"). That order survives a browser reload and a reconnect (both
 *  re-read the same full snapshot), a sleep/wake (the entry keeps its `Map`
 *  slot), a cold-boot restore, and — since #2141 taught its reattach to rebuild
 *  in one saved-order walk — a padi restart with surviving PTYs.
 *
 *  The dock used to discard all of that and re-sort by `ts`, which made
 *  every row's position a function of a clock nobody controls: a background
 *  agent finishing a turn reshuffled the list, and `Cmd+1..9` — bound to this
 *  order — meant something different every few minutes. Recency did not stop
 *  being visible; it stopped deciding WHERE a row sits. It still keys the
 *  activity window and the row's own "3m ago" cell (`ts`, below).
 *
 *  Urgency did not stop mattering either: a row blocked on you is surfaced by
 *  the dock's pinned needs-you strip ({@link needsYouEntries} → `dockTree.needsYou`),
 *  a fixed place that fills and empties, rather than by floating the row up
 *  through a list that then reflows around it.
 *
 *  Desktop `Dock.tsx`, the touch `DockList.tsx`, and the `Cmd+1..9`
 *  keyboard shortcut all read the same rows, through the same tree, so the
 *  visual row order and the row that a numeric shortcut activates can
 *  never disagree. Without this single source the Alt-held hint chips
 *  can lie about which terminal `Cmd+N` targets — the dock paints rows
 *  with parked terminals dimmed and pushed down, but a parallel
 *  derivation in `ActionContext.dockOrderedIds` would send the keystroke
 *  somewhere else entirely.
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
} from "@kolu/padi-client/surface";
import {
  type DockPaintBucket as PackageDockPaintBucket,
  type DockRowBucket,
  dockOverlayBucket,
  paintDockRow,
  type UnparkedPaintBucket,
} from "@kolu/solid-dockrow/rowValues";
import {
  type AttentionClass,
  agentUrgency,
  type TerminalId,
} from "kolu-common/surface";
import { match, P } from "ts-pattern";
import type { PaneNode } from "../../terminal/terminalTree";

// The row's PAINT fold — `DockRowBucket`, the overlay precedence, and
// `paintDockRow` — moved out with the row itself (`@kolu/solid-dockrow`): a
// consumer that renders kolu's row needs to decide which pip it paints, and a
// second implementation of that decision is exactly the drift the package
// exists to end. What stayed HERE is the ORDER fold, which reads the dock's own
// tile tree, its activity window and its ☾ filter — app state no package can
// see. The two folds share `dockOverlayBucket` so a future reorder cannot
// desync them across the package boundary.
export type { DockRowBucket };

/** Values the ORDER fold can actually emit. `linger` is paint-only. */
type DockOrderBucket = Exclude<DockRowBucket, "linger">;

// The PAINT fold's own emit-set and its unparked narrowing are the package's
// (`DockPaintBucket` / `UnparkedPaintBucket`) — re-spelling them here would be a
// second `Exclude` over the same union, agreeing with the first only until one
// of them moved.
type DockPaintBucket = PackageDockPaintBucket;

/** A split shares its parent's window fate, so it cannot independently park. */
type SubDockOrderBucket = Exclude<DockOrderBucket, "parked">;
type SubDockPaintBucket = UnparkedPaintBucket;

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

/** The neutral projection shared by every dock row. */
type DockRowCore = {
  id: TerminalId;
  /** The row's ORDER/FILTER bucket. Two live readers: `dockTree.ts`'s
   *  `filteredOut` (does the activity window / the ☾ toggle hide this row) and
   *  `dockRowAttrs`'s `data-bucket` (rail glow, styling hook, e2e). It does
   *  **not** decide strip membership — that is {@link DockRowCore.asking}.
   *  Reads `agentUrgency`, so a post-turn `waiting` is `idle` here. */
  bucket: DockOrderBucket;
  /** Blocked on YOU — the terminal's ATTENTION CLASS verbatim
   *  (`classOf(id) === "asking"`), which is exactly `statePipBind`'s `asking`,
   *  the ONE test every needs-you surface reads.
   *
   *  Carried on the row so the pinned strip's MEMBERSHIP and the entry's violet
   *  WAIT CHIP are the same fold rather than two folds that agree by luck.
   *  `pip` is this same class NARROWED by `dockOverlayBucket` — a parked or
   *  sleeping row paints `parked`/`sleeping` and never `awaiting` — and that
   *  narrowing is a PAINT rule, not an attention rule: a blocked agent is
   *  blocked whether or not the dock is currently colouring it dormant.
   *  Visibility is decided once, by `dockTree`'s filters, and carried on the
   *  strip's entry; it is never re-decided here. */
  asking: boolean;
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
 * every consumer (rail entries, section attention, `needsYouEntry`) re-walk a
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
 *  This is the ONE source for that derivation, and it has exactly two consumers
 *  left: `rankDockRows` feeds it to the staleness/window predicate, and the
 *  row's `RecencyCell` displays it. So the "Xs ago" a row shows is the exact age
 *  the window acts on — a 4h window never hides a row that reads "1h ago" or
 *  keeps one that reads "3d ago". It decides no POSITION: nothing here sorts.
 *  `null` (never-active, never-slept) passes through honestly rather than
 *  forging a fake epoch; both consumers render it as such. */
export function rowRecencyAt(meta: TerminalMetadata): number | null {
  return sleepingArm(meta)?.sleptAt ?? meta.lastActivityAt;
}

/** `ts` as a comparable number — `null` (never-active) ranks LAST, mirroring
 *  `agentProjection.ts`'s `recencyRank`.
 *
 *  Two consumers, and neither is the Recent band. INSIDE this module it folds a
 *  tile's newest activity (parent vs splits) for the staleness window; in
 *  `palette/fleetTerminals.ts`'s `rankFleetTerminalRows` it orders the fleet row
 *  list, which is what the ⌘⇧K *Terminals browse* list shows.
 *
 *  It is NOT what the ⌘K Recent band shows: `rootIndex.recentBand` re-sorts the
 *  same rows on WARMTH (`max(visitedAt, recencyAt)`), discarding this ordering
 *  entirely, so "most relevant terminal first" is currently computed twice on
 *  two keys and which one you see depends on which chord you pressed. That
 *  reconciliation — ordering is a palette policy, and `rootIndex.ts` claims to
 *  be its one home — is a standing follow-up; this comment at least stops
 *  naming the one view that is not time-ordered as the reason this exists.
 *
 *  It is no longer a dock ORDERING primitive: the dock's three sorts went away
 *  with #2141. */
export function tsRank(ts: number | null): number {
  return ts ?? Number.NEGATIVE_INFINITY;
}

/** Project a terminal id list into the bucket-classified rows the dock renders,
 *  **in the order the ids arrived** — creation order, straight off padi's
 *  registry (see the module header). `dockTree.ts` buckets these into repo
 *  sections and branch clusters; neither layer re-orders them.
 *
 *  `isStale` is a pure-temporal predicate
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
    // Read the attention class ONCE and carry both answers off it: the paint
    // bucket (class, narrowed by the dormancy overlay) and the raw membership
    // fact (`asking`). One read, so the row's colour and the strip's membership
    // can never come off two different frames of the same fold.
    const klass = classOf(id);
    rows.push({
      id,
      bucket: classifyDockRow(meta, parked),
      pip: paintDockRow(meta, klass, parked),
      asking: klass === "asking",
      ts: recencyAt,
      subRows,
    });
  }
  return rows;
}

/** Either half of a tile: the top-level row, or one of its splits at any depth.
 *  Spelled through `subRows` so `SubDockRow` stays module-private. */
export type NeedsYouRow = RankedDockRow | RankedDockRow["subRows"][number];

/** What the pinned strip renders: ONE BLOCKED AGENT, plus the tile it lives in.
 *
 *  - `blocked` is what is asked, painted, timed and navigated to.
 *  - `tile` is the DISPLAY IDENTITY (repo · branch, colour, intent). A split has
 *    none of its own — `getDisplayInfo` is keyed on top-level tiles — which is
 *    the whole reason the pair exists. They are the same object in the ordinary
 *    case.
 *
 *  A boolean here threw the second half away, and the strip painted the PARENT:
 *  no violet capsule at all (the parent's own `recencyMode` is `ago`/`hidden`),
 *  and a tooltip asserting the tile's newest activity as a wait — "waiting on
 *  you for 3s" over an agent that had waited twenty hours, because a chattier
 *  sibling split moved the tile-wide fold. */
export type NeedsYouEntry = {
  tile: RankedDockRow;
  blocked: NeedsYouRow;
};

/** Is this tile blocked on YOU, and which row inside it is — the pinned
 *  needs-you strip's membership test.
 *
 *  Reads the row's ATTENTION CLASS (`asking`), which is `statePipBind`'s
 *  `asking`: "the ONE test every surface reads for it — the row wash, the wait
 *  chip, the section count and the section jump all come off this rather than
 *  each re-testing `bucket === "awaiting"`, which is a different fold (ORDER)
 *  that agreed with the attention class only by luck". The strip's entry paints
 *  its violet capsule off `recencyMode(pip().asking)` — the same class — so the
 *  component's claim that its two renderings of one terminal cannot drift is
 *  now true by construction rather than by two folds coinciding.
 *
 *  It deliberately does NOT read `pip`. `pip` is this class narrowed by
 *  `dockOverlayBucket`, so `pip === "awaiting"` silently meant `asking ∧
 *  ¬parked ∧ ¬sleeping` — three independent axes, two of them undeclared. A
 *  shown-but-sleeping blocked agent wore the violet wash and the wait chip on
 *  its own row, was counted by its section header, and was missing from the
 *  strip above it, as a side effect of an overlay precedence written for
 *  colour.
 *
 *  **Nothing here decides visibility.** `dockTree` owns the dock's two filters
 *  and carries their verdict on the entry (`hiddenByFilter`); a row the
 *  activity window parked still earns the strip, because a twenty-hour wait
 *  falling out of a four-hour window is precisely the agent the strip exists
 *  for.
 *
 *  Returns EVERY blocked row in the tile, not the first. A tile can hold
 *  several agents — the main pane plus its splits, or two splits — and any of
 *  them can be `awaiting_user` at once. Answering with one (a `.find()`) left
 *  the second agent surfaced by colour and animation alone, which is the exact
 *  failure this strip exists to end. One entry per blocked agent, so the strip's
 *  length is the number of agents waiting on you, not the number of tiles that
 *  contain one. */
export function needsYouEntries(row: RankedDockRow): NeedsYouEntry[] {
  const blocked: NeedsYouRow[] = [];
  if (row.asking) blocked.push(row);
  for (const sub of row.subRows) if (sub.asking) blocked.push(sub);
  return blocked.map((b) => ({ tile: row, blocked: b }));
}

/** Fold the tile's pane TREE into its dock sub-entries: siblings in the store's
 *  own order, each one immediately followed by its own splits, one level
 *  deeper. A grandchild is a real parent→child edge — the Dock keeps that true
 *  tree, where the canvas flattens the same panes into one tab strip (#2059).
 *
 *  Siblings used to sort needs-you-first-then-recency here, which meant a
 *  tile's split tabs could sit in one order on the canvas and another in the
 *  dock, and either could reshuffle mid-glance. Taking the store's order
 *  verbatim is what makes the two surfaces agree by construction.
 *
 *  The tree ARRIVES from the store (`getPaneTree`), the same index whose flat
 *  shape the canvas paints; this module only classifies it. Ranking
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
  return nodes.flatMap((node) => {
    const row = rankSubRow(node.id, depth, getMeta, classOf);
    // IDs and projected metadata are independent reactive reads. Match the
    // top-level row contract above: reading a missing slot subscribes this memo
    // to its arrival, so omit the not-yet-paintable row for this frame; the
    // reactive recomputation includes it. Its own splits wait with it — an
    // entry indented under a row that isn't there reads as a lie.
    if (!row) return [];
    return [row, ...rankSubTree(node.children, getMeta, classOf, depth + 1)];
  });
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
  // RailSubChip all hand to `useStatePip`. Never synthesize per-surface. The
  // attention class is read ONCE and feeds both the paint bucket and `asking`,
  // exactly as at top level.
  const klass = classOf(id);
  const core = {
    id,
    depth,
    ts: rowRecencyAt(meta),
    pip: paintDockRow(meta, klass, false),
    asking: klass === "asking",
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
