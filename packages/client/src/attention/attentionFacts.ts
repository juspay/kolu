/** The attention FACTS a surface needs about one terminal, and the scope-level
 *  folds of the same question — kept in one file, pure, because the whole point
 *  is that they are the same question asked at three altitudes.
 *
 *  A terminal's attention state is exactly two things: which `attentionClass`
 *  padi's partition puts it in, and whether bytes are moving in it. Both come
 *  off the SAME mirrored frame — padi computes the class once and ships the
 *  answer as id lists, and `frameClassOf` reads it back. Nothing on this side
 *  re-derives the class from a second input: doing that put the host tab on one
 *  derivation and the pip beneath it on another, arriving on two subscriptions
 *  with independent timing, which is the very disagreement the partition exists
 *  to prevent.
 *
 *  Passing the pair around as ONE value (rather than as loose booleans a caller
 *  assembles per site) is what makes the old family of bugs unspellable: a call
 *  site cannot fabricate `{isLive:false,isFinished:false}` for a host it hasn't
 *  got facts for, because there is no such shape to fabricate.
 *
 *  Three altitudes, two predicates over one partition:
 *    • per terminal — `attentionActive(a.klass, a.live)` decides the pip's
 *      motion (`statePipBind`);
 *    • per host — `hostActiveIds` folds that host's mirrored frame into the ids
 *      the tab counts;
 *    • per scope — `scopeAttention` folds an arbitrary id set (a repo section's
 *      rows plus their splits) into the ids each capsule counts AND jumps over.
 *  Counting is `attentionCounted`, motion is `attentionActive`; both are named
 *  in the fenced vocabulary, so no surface subtracts `asking` by hand.
 *  `attentionFacts.test.ts` pins that the host fold agrees with the per-terminal
 *  predicate for every class × live combination, so a tab count and the moving
 *  pips can never disagree about what "active" means. That disagreement — a tab
 *  reading 2 next to three moving pips — is the defect this module exists to
 *  make impossible. */

import {
  type AttentionClass,
  ATTENTION_CLASSES,
  attentionActive,
  attentionCounted,
  type TerminalId,
} from "kolu-common/surface";

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

/** A host's mirrored urgency frame plus its live set — padi's partition
 *  carried as ONE map keyed by the class, not as sibling `*Ids` fields.
 *
 *  Keyed, because the partition is the thing that changes: as four positional
 *  fields, a new class had to be spelled into the frame type, the empty seed,
 *  the wire→frame translation and every reader, none of which the compiler
 *  checked — and the failure mode was the silent one, the new class simply
 *  never counted. Keyed by `FrameClass`, every one of those sites stops
 *  compiling until it decides. */
export interface HostAttentionFrame {
  readonly byClass: Readonly<Record<FrameClass, readonly TerminalId[]>>;
  /** Terminals moving bytes right now (kaval's meaningful-output edge). */
  readonly liveIds: readonly TerminalId[];
}

/** An empty frame — every class present and empty, so a partial reader never
 *  meets a missing list. */
export const EMPTY_FRAME: HostAttentionFrame = {
  byClass: { asking: [], working: [], linger: [], finished: [] },
  liveIds: [],
};

/** Which class list holds this id — the per-terminal read of the frame every
 *  fold below runs over, and the ONLY place a terminal's class is decided on
 *  the client. Not mentioned by any list means `idle`: no agent, or a host that
 *  hasn't reported. */
export function frameClassOf(
  frame: HostAttentionFrame,
  id: TerminalId,
): AttentionClass {
  for (const klass of FRAME_CLASSES) {
    if (frame.byClass[klass].includes(id)) return klass;
  }
  return "idle";
}

/** The terminals on a host that are ACTIVE but not blocked on you — what the
 *  host tab's rust count counts.
 *
 *  Derived rather than counted per terminal because a background host's
 *  terminals are not mirrored at all: its tab knows only these id lists. It
 *  FOLDS THROUGH the shared predicate rather than reproducing its membership —
 *  the moment this restated "working and linger unconditionally, finished and
 *  idle only while live" in its own arithmetic, teaching `attentionCounted` a
 *  new rule stopped reaching the tab, in a different package, with no compiler
 *  help.
 *
 *  Ids, not a number, so the count is `.length` at the read site — the urgency
 *  cell's own no-second-source law, all the way to the pixel. */
export function hostActiveIds(
  frame: HostAttentionFrame,
): readonly TerminalId[] {
  const out: TerminalId[] = [];
  const seen = new Set<TerminalId>();
  for (const id of [
    ...FRAME_CLASSES.flatMap((klass) => frame.byClass[klass]),
    ...frame.liveIds,
  ]) {
    // `liveIds` overlaps the class lists freely (a thinking agent usually IS
    // printing), so this union — unlike the class lists among themselves —
    // genuinely needs the de-dup.
    if (seen.has(id)) continue;
    seen.add(id);
    if (attentionCounted(frameClassOf(frame, id), frame.liveIds.includes(id))) {
      out.push(id);
    }
  }
  return out;
}

/** Is this terminal active — does its mark MOVE? Re-exported at the value level
 *  so a surface reads the predicate off the value it already holds. */
export function isActive(a: TerminalAttention): boolean {
  return attentionActive(a.klass, a.live);
}

/** Does a scope COUNT this terminal in its activity leg? `asking` has its own
 *  violet count and must never also swell the rust one. */
export function isCounted(a: TerminalAttention): boolean {
  return attentionCounted(a.klass, a.live);
}

/** A scope's attention summary — the ids each leg of the header's
 *  `AttentionTriplet` counts.
 *
 *  IDS, not counts: a capsule renders `.length` and jumps over the very list it
 *  counted, so "the number said 1 and the click did nothing" is not a state the
 *  two can reach. It was reachable — the count folded every row including the
 *  ones the activity window had parked (deliberately: an agent blocked long
 *  enough to fall out of the window is the one you most need told about) while
 *  the click filtered the VISIBLE rows, so the flagship case rendered a button
 *  reading "1" that did nothing at all.
 *
 *  Asking and active are mutually exclusive — they answer the same question
 *  (what state is this terminal in) and a row paints one or the other, which
 *  `attentionCounted` decides rather than an `else` here. Unread is counted
 *  INDEPENDENTLY, because it is a different axis: state is the pip's colour,
 *  unread is the amber badge riding on top of it (the StatePip axis contract),
 *  and a row genuinely wears both.
 *
 *  Takes bare ids — the third altitude of the same fold belongs beside its two
 *  siblings, not in the dock's grouping module; flattening rows into ids is the
 *  dock's job (`useSectionAttention`). */
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
