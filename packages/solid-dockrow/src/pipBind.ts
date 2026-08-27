/** The dock row's PIP FOLD — terminal facts in, one `StatePip` prop bag out.
 *
 *  Four pure steps, in one file because they are one answer:
 *    · {@link paintDockRow}   — attention class + dormancy → the row's PAINT bucket
 *    · {@link pipVariant}     — bucket → the shared `PipVariant` core
 *    · {@link pipGlyphFor}    — who is driving the terminal → the identity glyph
 *    · {@link bindStatePip}   — all of it, plus motion / activity / unread, as
 *                               the prop bag `StatePip` renders
 *
 *  It lives in the ROW package rather than in kolu-client because the row is not
 *  the only surface that needs it and a fleet mirror is not the only consumer
 *  that would otherwise re-derive it: `bindStatePip` is the fold every kolu
 *  StatePip surface (dock row, touch row, split row, needs-you strip, tile
 *  title, workspace card, rail chip) already shares, and the whole point of
 *  shipping the row is that a mirror paints the identical pip rather than
 *  inventing a second answer. `@kolu/solid-statepip` renders a `PipVariant`;
 *  this decides which one a terminal is.
 *
 *  Everything here is a pure function of VALUES — no store reads, no reactive
 *  context — so the module carries no JSX and rides the `./rowValues` subpath a
 *  node-environment test can import without a Solid transform. */

import {
  activeArm,
  sleepingArm,
  type TerminalMetadata,
} from "@kolu/padi-client/vocab";
import type {
  PipGlyphId,
  PipMotionKind,
  PipVariant,
} from "@kolu/solid-statepip/pipVariant";
import { pipForPaintClass } from "@kolu/solid-statepip/pipVariant";
import {
  type AgentPaintClass,
  type AttentionClass,
  paintClassOf,
} from "@kolu/terminal-vocab/agentProjection";
import { isActive, type TerminalAttention } from "@kolu/padi-client/attention";

/** Per-row render variant. Declared as an EXTENSION of the shared
 *  `AgentPaintClass` (awaiting | linger | working | none) plus the dock's own
 *  triage tail, so `DockRowBucket` CONTAINS `AgentPaintClass` by declaration —
 *  the paint class the row pip and the tile title both feed into `StatePip` is
 *  then a declared subset of this union, not a literal coincidence. `parked` is
 *  its own bucket (not folded into idle) because it carries a different visual
 *  treatment and routes through staleness, not the idle-bucket classifier.
 *  `sleeping` is its own bucket for the fresh-within-window case — a freshly-
 *  slept tile reads "asleep" with its ☾ row. But staleness wins over it: once a
 *  slept tile's last activity falls outside the window it routes to `parked`. */
export type DockRowBucket = AgentPaintClass | "idle" | "sleeping" | "parked";

/** Values the PAINT fold can actually emit. A classless row paints `idle`. */
export type DockPaintBucket = Exclude<DockRowBucket, "none">;

/** What a surface with no activity window of its own can get back: a row it
 *  never parks cannot paint `parked`. The overloads below carry that narrowing,
 *  so a caller that passes no `parked` argument (or a literal `false`) does not
 *  have to re-widen its own row type to admit a bucket it cannot reach. */
export type UnparkedPaintBucket = Exclude<DockPaintBucket, "parked">;

/** The row-overlay precedence shared by BOTH dock folds (order, in
 *  kolu-client's `dockRowRanking`, and paint, below): parked wins over
 *  sleeping. Parked is checked FIRST because a sleeping tile is still subject
 *  to the activity window — a *fresh* slept tile keeps its ☾ row, but once its
 *  last activity falls outside the window it routes to `parked` (which
 *  `dockTree` hides) like any other stale row, otherwise yesterday's dormant
 *  terminals pile up in the dock and the window selector can't compress them.
 *
 *  Exported — not private to this module — because the ORDER fold that shares
 *  it stayed behind in the app (it reads the dock's tile tree, which no package
 *  can see). One precedence, called from both sides, is what keeps the two
 *  folds from desyncing across the package boundary. */
export function dockOverlayBucket(
  meta: TerminalMetadata,
  parked: boolean,
): "parked" | "sleeping" | undefined {
  if (parked) return "parked";
  if (sleepingArm(meta)) return "sleeping";
  return undefined;
}

/** The PIP bucket a row paints — separate from the ORDER bucket so a row's pip
 *  COLOUR is decided once and reads identically across the dock row and the
 *  tile title (both render through `StatePip`).
 *
 *  It paints the terminal's ATTENTION CLASS — the same value its motion, its
 *  wash and every count read — never a class re-derived from the terminal's own
 *  metadata; the two-subscriptions argument for that is stated once in
 *  `@kolu/padi-client/attention`'s header. Colour was the last channel still
 *  believing the metadata, which is why it is spelled out here.
 *
 *  A quiet host therefore paints quiet: if the frame has not arrived, every mark
 *  reads idle rather than confidently colouring from a fact no count agrees
 *  with. That is the honest reading, and it is the same fact the host tab
 *  already shows by dimming.
 *
 *  A fresh `waiting` agent paints `linger` (the lingering dim-alert) even though
 *  the dock's order fold ranks it `idle` — order≠colour, deliberately.
 *  Dock-only triage: `sleeping` / `parked` come off the metadata overlay, which
 *  is where they live. `parked` defaults false for non-windowed surfaces (title
 *  / switcher / a fleet mirror with no activity window of its own). */
export function paintDockRow(
  meta: TerminalMetadata,
  klass: AttentionClass,
): UnparkedPaintBucket;
export function paintDockRow(
  meta: TerminalMetadata,
  klass: AttentionClass,
  parked: false,
): UnparkedPaintBucket;
export function paintDockRow(
  meta: TerminalMetadata,
  klass: AttentionClass,
  parked: boolean,
): DockPaintBucket;
export function paintDockRow(
  meta: TerminalMetadata,
  klass: AttentionClass,
  parked = false,
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
  // (no glow at all), but every dock row core is an identity mark: `PIP_BODY.empty`
  // would swallow the shell's identity glyph, so a classless row paints the
  // quiet `idle` body instead of nothing.
  return paint === "none" ? "idle" : paint;
}

/** The row bucket → `PipVariant` rule — the glue that feeds the CORE of the
 *  shared `StatePip`.
 *
 *  The three agent-paint buckets route through the SHARED `pipForPaintClass`,
 *  so the pip a given agent paint class shows is defined ONCE and can't drift
 *  between surfaces. This function adds only the dock-only
 *  `idle`/`sleeping`/`parked` triage buckets that have no agent paint to share.
 *
 *  `unread` is deliberately NOT folded in: an unread alert used to REPLACE the
 *  whole pip with a loud `attention` disk; it now rides as the indicator's amber
 *  corner BADGE (`StatePip`'s `alert` prop) BESIDE the live state core instead
 *  of hiding it — so the obligation and the state read at once.
 *
 *  Identity (who is driving the terminal) is a SEPARATE axis —
 *  {@link pipGlyphFor} — so paint and brand mark don't complect. */
export function pipVariant(bucket: DockRowBucket): PipVariant {
  switch (bucket) {
    // The agent-paint subset (`DockRowBucket` extends `AgentPaintClass`) folds
    // through the shared definition.
    case "awaiting":
    case "linger":
    case "working":
    case "none":
      return pipForPaintClass(bucket);
    // The dock's own triage tail — no agent paint to share.
    case "idle":
      return "idle";
    case "sleeping":
      return "sleeping";
    case "parked":
      return "empty";
  }
}

/** Identity glyph for a row/title pip — live agent kind, else the persisted
 *  resume identity on a sleeping (or just-quit) terminal, else the shell
 *  prompt. One place every StatePip call site reads "who is driving this". */
export function pipGlyphFor(meta: TerminalMetadata): PipGlyphId {
  const live = activeArm(meta)?.agent?.kind;
  if (live) return live;
  const target = meta.restoreTarget;
  if (target?.kind === "exact") return target.agent.kind;
  return "shell";
}

/** Which motion class the glyph runs. Collapsed: inactive/empty/sleeping →
 *  none; active needs-you → glow; active otherwise → spin. The needs-you test
 *  is the VARIANT itself — `awaiting` means exactly `awaiting_user` (the
 *  `linger` split), so motion never re-derives the state from the agent.
 *
 *  WHETHER the terminal is active is not decided here — it is `attentionActive`,
 *  the one predicate shared with every count kolu renders. This only chooses
 *  which motion an active mark runs. Paint stays decoupled: a lingering agent
 *  keeps its dim violet via `PipVariant` `linger` whether or not it still
 *  moves. */
export function pipMotionKind(input: {
  variant: PipVariant;
  active: boolean;
}): PipMotionKind {
  if (
    input.variant === "empty" ||
    input.variant === "sleeping" ||
    !input.active
  ) {
    return "none";
  }
  return input.variant === "awaiting" ? "glow" : "spin";
}

/** The bound `StatePip` prop bag — identity · paint · motion · activity ·
 *  unread · dormancy folded once so call sites cannot drift. */
export type StatePipBind = {
  variant: PipVariant;
  glyph: PipGlyphId;
  motion: PipMotionKind;
  /** Effectively active — recency hide, `data-active`. Not raw PTY bytes. */
  active: boolean;
  /** The agent is blocked on YOU. The ONE test every surface reads for it —
   *  the row wash, the wait chip, the section count and the section jump all
   *  come off this rather than each re-testing `bucket === "awaiting"`, which
   *  is a different fold (ORDER) that agreed with the attention class only by
   *  luck and would stop the moment either partition moved. */
  asking: boolean;
  /** Raw meaningful output — a11y "live output" only. */
  bytesLive: boolean;
  /** Quiet shell with live PTY bytes → busy orange without agent "Working". */
  shellLive: boolean;
  /** Dormant terminal — row/title recede (same token everywhere). */
  sleeping: boolean;
  alert: boolean;
  alertLabel: string;
};

/** Pure terminal facts → StatePip props.
 *
 *  `attention` arrives as ONE value from the attention fold rather than as a
 *  handful of booleans each call site assembles: the ⌘K palette used to hand
 *  this function `{isLive:false,isFinished:false}` for every background host,
 *  and so every terminal on a host you weren't looking at read as idle there.
 *  With the facts arriving as a value there is nothing to fabricate. */
export function bindStatePip(input: {
  meta: TerminalMetadata;
  attention: TerminalAttention;
  unread: boolean;
  /** A surface that already computed the paint bucket (the dock, off its own
   *  ranking pass over this same class) hands it in; every other surface omits
   *  it and this folds the class itself. */
  pipBucket?: DockRowBucket;
}): StatePipBind {
  const agent = activeArm(input.meta)?.agent;
  // Paint comes off the SAME attention value as motion, wash and every count —
  // never re-derived from the metadata.
  const bucket =
    input.pipBucket ?? paintDockRow(input.meta, input.attention.klass);
  const variant = pipVariant(bucket);
  // The ONE activity predicate — the same function every host tab and section
  // header counts with, so a still mark is never counted and a moving one never
  // missed.
  const active = isActive(input.attention);
  const motion = pipMotionKind({ variant, active });
  // Live shell keeps idle *variant* (title/a11y stay "Idle") but busy-orange
  // paint via shellLive — not agent "Working".
  const shellLive = !agent && input.attention.live && variant === "idle";
  return {
    variant,
    glyph: pipGlyphFor(input.meta),
    motion,
    active,
    asking: input.attention.klass === "asking",
    bytesLive: input.attention.live,
    shellLive,
    sleeping: sleepingArm(input.meta) !== undefined,
    alert: input.unread,
    alertLabel: "unread alert",
  };
}
