/** The ATTENTION FOLD — padi's two attention feeds, folded into the facts a
 *  surface paints and counts from.
 *
 *  Two members of `padiSurface` together answer "what is happening in this
 *  terminal": the `urgency` CELL (padi's `attentionClass` partition, computed
 *  once, on the host, and shipped as id lists) and the `activity` STREAM (each
 *  frame the full live set). Everything below is a pure function over those two
 *  values — no transport, no store, no reactive context — so the client that
 *  mirrors padi over a socket and the fleet mirror that dials the same surface
 *  compute the IDENTICAL answer instead of each restating it.
 *
 *  It lives beside the contract it folds, in the client package, for the reason
 *  the package exists at all: a consumer that dials padi (olai) gets the feeds
 *  and the reading of them from the one directory it copies. The fold used to
 *  sit in `kolu-client`, out of reach, which left a mirror with padi's id lists
 *  and no definition of what they mean — and "what they mean" is exactly where
 *  two implementations drift.
 *
 *  A terminal's attention state is exactly two things: which `attentionClass`
 *  padi's partition puts it in, and whether bytes are moving in it. Both come
 *  off the SAME mirrored frame — padi computes the class once and ships the
 *  answer as id lists, and {@link frameClassOf} reads it back. Nothing on this
 *  side re-derives the class from a second input: doing that put the host tab on
 *  one derivation and the pip beneath it on another, arriving on two
 *  subscriptions with independent timing, which is the very disagreement the
 *  partition exists to prevent.
 *
 *  Passing the pair around as ONE value (rather than as loose booleans a caller
 *  assembles per site) is what makes the old family of bugs unspellable: a call
 *  site cannot fabricate `{isLive:false,isFinished:false}` for a host it hasn't
 *  got facts for, because there is no such shape to fabricate.
 *
 *  Three altitudes, two predicates over one partition:
 *    • per terminal — `attentionActive(a.klass, a.live)` decides the pip's
 *      motion (`@kolu/solid-dockrow`'s `bindStatePip`);
 *    • per host — {@link hostActiveIds} folds that host's frame into the ids a
 *      host tab counts;
 *    • per scope — {@link scopeAttention} folds an arbitrary id set (a repo
 *      section's rows plus their splits) into the ids each capsule counts AND
 *      jumps over.
 *  Counting is `attentionCounted`, motion is `attentionActive`; both are named
 *  in the fenced vocabulary (`@kolu/terminal-vocab/agentProjection`), so no
 *  surface subtracts `asking` by hand. */

import {
  type AttentionClass,
  ATTENTION_CLASSES,
  attentionActive,
  attentionCounted,
} from "@kolu/terminal-vocab/agentProjection";
import type { TerminalId } from "@kolu/terminal-vocab/schema";
import type { PadiUrgency } from "./surface.ts";

/** One terminal's attention facts. `klass` is padi's partition (which urgency
 *  list it is in); `live` is kaval's raw byte-motion edge. */
export interface TerminalAttention {
  readonly klass: AttentionClass;
  readonly live: boolean;
}

/** The classes a frame carries an id list for — every class except `idle`,
 *  which is the ABSENCE of a mention rather than a list of its own. */
export type FrameClass = Exclude<AttentionClass, "idle">;

/** The frame's classes, enumerated from the vocabulary's own fenced list — so
 *  a sixth `AttentionClass` reaches every reader below by construction instead
 *  of being silently dropped from the walk. */
export const FRAME_CLASSES: readonly FrameClass[] = ATTENTION_CLASSES.filter(
  (c): c is FrameClass => c !== "idle",
);

/** A host's attention frame — padi's partition carried as ONE map keyed by the
 *  class, not as sibling `*Ids` fields.
 *
 *  Keyed, because the partition is the thing that changes: as four positional
 *  fields, a new class had to be spelled into the frame type, the empty seed,
 *  the wire→frame translation and every reader, none of which the compiler
 *  checked — and the failure mode was the silent one, the new class simply never
 *  counted. Keyed by `FrameClass`, every one of those sites stops compiling
 *  until it decides. */
export interface HostAttentionFrame {
  readonly byClass: Readonly<Record<FrameClass, readonly TerminalId[]>>;
  /** Terminals moving bytes right now (kaval's meaningful-output edge). */
  readonly liveIds: readonly TerminalId[];
}

/** A fresh empty class map — every class present and empty, so a partial reader
 *  never meets a missing list.
 *
 *  A FUNCTION, not a shared constant: the literal
 *  `{asking:[],working:[],linger:[],finished:[]}` was written out at three
 *  sites, and a shared object would have every "nothing here yet" host pointing
 *  at the SAME nested arrays — one accidental push corrupts the seed for all of
 *  them. */
export function emptyByClass(): Record<FrameClass, TerminalId[]> {
  return { asking: [], working: [], linger: [], finished: [] };
}

/** An empty frame — the reading for a host nothing is known about.
 *
 *  FROZEN, and its lists with it. `emptyByClass` is a function precisely so no
 *  two "nothing here yet" hosts share nested arrays that one accidental push
 *  corrupts for all of them — and then this constant handed every reader the
 *  same nested arrays anyway. Freezing keeps the one shared reading safe to
 *  share; a caller that needs a MUTABLE seed calls `emptyByClass()`. */
export const EMPTY_FRAME: HostAttentionFrame = Object.freeze({
  byClass: Object.freeze({
    asking: Object.freeze([] as readonly TerminalId[]),
    working: Object.freeze([] as readonly TerminalId[]),
    linger: Object.freeze([] as readonly TerminalId[]),
    finished: Object.freeze([] as readonly TerminalId[]),
  }),
  liveIds: Object.freeze([] as readonly TerminalId[]),
});

/** The WIRE→FRAME translation: padi's `urgency` cell as the class map every
 *  reader below speaks.
 *
 *  This is where the cell's positional `awaitingIds` name becomes the class name
 *  `asking`, and it is the ONE place that rename happens — it used to be an
 *  object literal inside a kolu-client effect, which is exactly the sort of
 *  four-line fold a second consumer re-types slightly differently. The arrays
 *  are COPIED because a live-mirroring client hands back a `reconcile` proxy
 *  that mutates in place across ticks; a frame that aliased it would silently
 *  change under a reader holding it.
 *
 *  It takes the urgency value ALONE and leaves `liveIds` to the caller, because
 *  the two feeds arrive on independent subscriptions at wildly different
 *  cadences — an agent transition versus kaval's ~1 s byte edge — and merging
 *  them here would invalidate a class-only reader on every byte tick. */
export function frameByClass(
  urgency: PadiUrgency,
): Record<FrameClass, TerminalId[]> {
  return {
    asking: [...urgency.awaitingIds],
    working: [...urgency.workingIds],
    linger: [...urgency.lingerIds],
    finished: [...urgency.finishedIds],
  };
}

/** Which class list holds this id — the per-terminal read of the frame every
 *  fold below runs over, and the ONLY place a terminal's class is decided on the
 *  consumer side. Not mentioned by any list means `idle`: no agent, or a host
 *  that hasn't reported. */
export function frameClassOf(
  frame: HostAttentionFrame,
  id: TerminalId,
): AttentionClass {
  for (const klass of FRAME_CLASSES) {
    if (frame.byClass[klass].includes(id)) return klass;
  }
  return "idle";
}

/** The terminals on a host that are ACTIVE but not blocked on you — what a host
 *  tab's activity count counts.
 *
 *  Derived rather than counted per terminal because a background host's
 *  terminals are not mirrored at all: its tab knows only these id lists. It
 *  FOLDS THROUGH the shared predicate rather than reproducing its membership —
 *  the moment this restated "working and linger unconditionally, finished and
 *  idle only while live" in its own arithmetic, teaching `attentionCounted` a
 *  new rule stopped reaching the tab, with no compiler help.
 *
 *  Ids, not a number, so the count is `.length` at the read site — the urgency
 *  cell's own no-second-source law, all the way to the pixel. */
export function hostActiveIds(
  frame: HostAttentionFrame,
): readonly TerminalId[] {
  // Index the frame ONCE. Asking `frameClassOf` per id would rescan every class
  // list for every id — quadratic in a host's terminals, re-run on each reactive
  // read of the tab's count. The membership rule still comes from
  // `attentionCounted`; only the lookup is indexed.
  // FIRST-WINS, matching `frameClassOf`'s walk exactly. The partition is
  // disjoint today so no id is in two lists and the two orders agree — but they
  // agree by luck, not by construction, and this module's own header calls
  // `frameClassOf` the one place a terminal's class is decided. A last-wins
  // `set` here was a SECOND decision with the opposite tie-break: a sixth,
  // overlapping class would split the pip from the host-tab count that
  // summarises it, which is the exact disagreement this module exists to
  // prevent.
  const klassOf = new Map<TerminalId, FrameClass>();
  for (const klass of FRAME_CLASSES) {
    for (const id of frame.byClass[klass]) {
      if (!klassOf.has(id)) klassOf.set(id, klass);
    }
  }
  const live = new Set(frame.liveIds);
  const out: TerminalId[] = [];
  const seen = new Set<TerminalId>();
  // `liveIds` overlaps the class lists freely (a thinking agent usually IS
  // printing), so this union — unlike the class lists among themselves —
  // genuinely needs the de-dup.
  for (const id of [...klassOf.keys(), ...frame.liveIds]) {
    if (seen.has(id)) continue;
    seen.add(id);
    if (attentionCounted(klassOf.get(id) ?? "idle", live.has(id))) out.push(id);
  }
  return out;
}

/** Is this terminal active — does its mark MOVE? Re-exported at the value level
 *  so a surface reads the predicate off the value it already holds. */
export function isActive(a: TerminalAttention): boolean {
  return attentionActive(a.klass, a.live);
}

/** Does a scope COUNT this terminal in its activity leg? The membership rule
 *  (and why `asking` is excluded) is `attentionCounted`'s, in the vocabulary. */
export function isCounted(a: TerminalAttention): boolean {
  return attentionCounted(a.klass, a.live);
}

/** A scope's attention summary — the ids each leg of a header's attention
 *  triplet counts.
 *
 *  IDS, not counts: a capsule renders `.length` and jumps over the very list it
 *  counted, so "the number said 1 and the click did nothing" is not a state the
 *  two can reach. It was reachable — the count folded every row including the
 *  ones an activity window had parked (deliberately: an agent blocked long
 *  enough to fall out of the window is the one you most need told about) while
 *  the click filtered the VISIBLE rows, so the flagship case rendered a button
 *  reading "1" that did nothing at all.
 *
 *  Asking and active are mutually exclusive — `attentionCounted` decides that,
 *  never an `else` here. Unread is counted INDEPENDENTLY, because it is a
 *  different axis: state is the pip's colour, unread is the amber badge riding
 *  on top of it (the StatePip axis contract), and a row genuinely wears both.
 *
 *  Takes bare ids — flattening a section's rows into ids is the surface's job. */
export function scopeAttention(
  ids: readonly TerminalId[],
  isUnread: (id: TerminalId) => boolean,
  attentionOf: (id: TerminalId) => TerminalAttention,
): {
  activeIds: readonly TerminalId[];
  askingIds: readonly TerminalId[];
  unseenIds: readonly TerminalId[];
} {
  const activeIds: TerminalId[] = [];
  const askingIds: TerminalId[] = [];
  const unseenIds: TerminalId[] = [];
  for (const id of ids) {
    const attention = attentionOf(id);
    if (attention.klass === "asking") askingIds.push(id);
    if (isCounted(attention)) activeIds.push(id);
    if (isUnread(id)) unseenIds.push(id);
  }
  return { activeIds, askingIds, unseenIds };
}
