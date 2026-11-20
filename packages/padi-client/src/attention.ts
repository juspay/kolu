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
 *  class, not as sibling `*Ids` fields. */
export interface HostAttentionFrame {
  readonly byClass: Readonly<Record<FrameClass, readonly TerminalId[]>>;
  /** Terminals moving bytes right now (kaval's meaningful-output edge). */
  readonly liveIds: readonly TerminalId[];
}

/** A fresh empty class map — every class present and empty, so a partial reader
 *  never meets a missing list. A new object each call; the lists are the
 *  caller's to mutate. */
export function emptyByClass(): Record<FrameClass, TerminalId[]> {
  return { asking: [], working: [], linger: [], finished: [] };
}

/** An empty frame — the reading for a host nothing is known about.
 *
 *  FROZEN, and its lists with it; a caller that needs a MUTABLE seed calls
 *  `emptyByClass()`. */
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
 *  reader below speaks — the cell's positional `awaitingIds` becomes the class
 *  name `asking`.
 *
 *  The arrays are COPIED, so the frame never aliases a live-mirroring client's
 *  `reconcile` proxy. It takes the urgency value ALONE and leaves `liveIds` to
 *  the caller. */
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

/** Which class list holds this id — not mentioned by any list means `idle`: no
 *  agent, or a host that hasn't reported. */
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
 *  tab's activity count counts. */
export function hostActiveIds(
  frame: HostAttentionFrame,
): readonly TerminalId[] {
  const live = new Set(frame.liveIds);
  const out: TerminalId[] = [];
  const seen = new Set<TerminalId>();
  for (const klass of FRAME_CLASSES) {
    for (const id of frame.byClass[klass]) {
      if (seen.has(id)) continue;
      seen.add(id);
      if (attentionCounted(frameClassOf(frame, id), live.has(id))) out.push(id);
    }
  }
  for (const id of frame.liveIds) {
    if (seen.has(id)) continue;
    seen.add(id);
    if (attentionCounted(frameClassOf(frame, id), true)) out.push(id);
  }
  return out;
}

/** Is this terminal active — does its mark MOVE? */
export function isActive(a: TerminalAttention): boolean {
  return attentionActive(a.klass, a.live);
}

/** Does a scope COUNT this terminal in its activity leg? The membership rule
 *  (and why `asking` is excluded) is `attentionCounted`'s, in the vocabulary. */
export function isCounted(a: TerminalAttention): boolean {
  return attentionCounted(a.klass, a.live);
}

/** A scope's attention summary — the ids each leg of a header's attention
 *  triplet counts. */
export interface ScopeAttention {
  readonly activeIds: readonly TerminalId[];
  readonly askingIds: readonly TerminalId[];
  readonly unseenIds: readonly TerminalId[];
}

/** A scope's {@link ScopeAttention}, over bare ids — flattening a section's rows
 *  into ids is the surface's job. */
export function scopeAttention(
  ids: readonly TerminalId[],
  isUnread: (id: TerminalId) => boolean,
  attentionOf: (id: TerminalId) => TerminalAttention,
): ScopeAttention {
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
