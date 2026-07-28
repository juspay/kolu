/** Dock row ranking — the single source for "what live terminals does the dock
 *  show, and how is each one classified".
 *
 *  It owns the row SET (which terminals earn a row, and each row's order bucket,
 *  paint bucket and recency key) and the two ordering ingredients every dock
 *  surface shares: `DOCK_ROW_BUCKET_PRIORITY` and `tsRank`. It does NOT own the
 *  final painted order of top-level rows: `dockTree.ts` re-sorts them
 *  blocked-first (`compareRows`, layered on THIS module's priority table) after
 *  clustering them by branch, so the recency-first order `rankDockRows` returns
 *  is a baseline the tree refines — not the sequence on screen.
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
  parked: boolean = false,
): DockRowBucket {
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

export type RankedDockRow = {
  id: TerminalId;
  /** The ORDER bucket — read through `DOCK_ROW_BUCKET_PRIORITY` by BOTH sorts
   *  that touch a row: this module's `ts`-tiebreak below, and `dockTree.ts`'s
   *  blocked-first leg for top-level rows. Also the `data-bucket` attribute /
   *  rail-glow. Reads `agentUrgency`, so `waiting` is `idle` here (it does not
   *  float into the needs-you order). */
  bucket: DockRowBucket;
  /** The PIP bucket — drives the row's `StatePip` colour, decoupled from order
   *  so it reads identically to the tile title's pip. Reads the terminal's
   *  ATTENTION CLASS (the same value its motion and every count read), so a
   *  fresh `waiting` agent is `linger` here — it keeps a dim glow while the
   *  ORDER bucket ranks it idle. */
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

/** Project a terminal id list into the recency-sorted, bucket-classified rows
 *  the dock renders — the BASELINE order (`dockTree.ts` clusters and re-sorts
 *  top-level rows blocked-first on top of it; see the module header). Secondary
 *  key is bucket priority so never-touched plain shells don't outrank an idle
 *  terminal with the same `ts === null`. `isStale` is a pure-temporal predicate
 *  over a recency timestamp — `rowRecencyAt` (`lastActivityAt` for an active
 *  tile, `sleptAt` for a sleeping one). Identity for stale-but-still-awaiting
 *  agents lives at the render layer (`QuietRowBody` paints `AgentIndicator` when
 *  `meta.agent` is set), not in the bucket decision here. */
export function rankDockRows(
  ids: readonly TerminalId[],
  getMeta: (id: TerminalId) => TerminalMetadata | undefined,
  isStale: (lastActivityAt: number | null) => boolean,
  classOf: (id: TerminalId) => AttentionClass,
): RankedDockRow[] {
  const rows: RankedDockRow[] = [];
  for (const id of ids) {
    const meta = getMeta(id);
    if (!meta) continue;
    const recencyAt = rowRecencyAt(meta);
    const parked = isStale(recencyAt);
    rows.push({
      id,
      bucket: classifyDockRow(meta, parked),
      pip: paintDockRow(meta, classOf(id), parked),
      ts: recencyAt,
    });
  }
  rows.sort(byRecencyThenBucket);
  return rows;
}

function byRecencyThenBucket(a: RankedDockRow, b: RankedDockRow): number {
  if (a.ts !== b.ts) return tsRank(b.ts) - tsRank(a.ts);
  return (
    DOCK_ROW_BUCKET_PRIORITY[a.bucket] - DOCK_ROW_BUCKET_PRIORITY[b.bucket]
  );
}
