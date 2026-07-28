/** The PURE attention transition decision — the #1177-class logic of `useAttention`,
 *  kept in its own wire-free file so it is unit-testable without padiMap / the app
 *  owner. Given one host's previous `urgency` cell and its current one, it decides
 *  which terminals should chime and which ended their attention episode. */

import type { TerminalId } from "kolu-common/surface";
import type { HostAttentionFrame } from "./attentionFacts";

/** The two lists the attention engine actually diffs — deliberately NOT the
 *  wire's `PadiUrgency`. The engine's memory should be described by what it
 *  compares, not by what the transport happens to carry: typing it as the wire
 *  value meant widening the cell forced two more array copies per host per
 *  frame that nothing ever read, with a comment admitting as much, and every
 *  future wire field would land here the same way.
 *
 *  It is a `Pick` of the frame's OWN class map, not a look-alike with `*Ids`
 *  names. The narrowing is the point and stays; the renaming was the mistake —
 *  a second `askingIds`/`finishedIds` dialect downstream of the one wire→frame
 *  seam forced every caller to mint an adapter object per host per frame just
 *  to re-spell two lists it already held. Same keys, fewer of them. */
export type AttentionFrame = Pick<
  HostAttentionFrame["byClass"],
  "asking" | "finished"
>;

export interface AttentionTransition {
  /** Terminals that should chime (subject to the caller's fire-once latch) — a
   *  FRESH entry into the attention class, or an ESCALATION into asking from a
   *  non-asking state (a real gate over an already-finished row). `asking` selects
   *  the "needs input" vs "finished" copy. A de-escalation asking→finished is NOT
   *  a candidate. */
  candidates: Array<{ id: TerminalId; asking: boolean }>;
  /** Terminals that left BOTH sets (their agent went back to work) — the episode
   *  boundary the caller uses to clear the fire-once latch. */
  ended: TerminalId[];
}

/** `prev === null` is the baseline — the FIRST frame per host. A discovery is
 *  definitionally not a transition, so it yields no candidates and no ends; the
 *  rule lives HERE, once, not as a "remember to check prev" guard at each caller. */
export function attentionTransitions(
  prev: AttentionFrame | null,
  cur: AttentionFrame,
): AttentionTransition {
  if (prev === null) return { candidates: [], ended: [] };

  const nextAsk = new Set(cur.asking);
  const nextFin = new Set(cur.finished);
  const prevAsk = new Set(prev.asking);
  const prevFin = new Set(prev.finished);

  // Walk the source arrays directly (the two buckets are disjoint and each id is
  // unique, so `asking` then `finished` IS the union) — no throwaway
  // spread array per frame on this ~150 ms-per-host hot path.
  const ended: TerminalId[] = [];
  for (const id of prev.asking) {
    if (!nextAsk.has(id) && !nextFin.has(id)) ended.push(id);
  }
  for (const id of prev.finished) {
    if (!nextAsk.has(id) && !nextFin.has(id)) ended.push(id);
  }

  const candidates: Array<{ id: TerminalId; asking: boolean }> = [];
  // An ASKING id chimes unless it was already asking — a fresh entry AND a
  // finished→asking escalation both reduce to "wasn't asking last frame" (#1177).
  for (const id of cur.asking) {
    if (!prevAsk.has(id)) candidates.push({ id, asking: true });
  }
  // A FINISHED id chimes only as a FRESH entry into the class — it was in neither
  // prev set. (A de-escalation asking→finished, still in class, is not a candidate.)
  for (const id of cur.finished) {
    if (!prevAsk.has(id) && !prevFin.has(id)) {
      candidates.push({ id, asking: false });
    }
  }
  return { candidates, ended };
}

/** The next "unseen finished" set for ONE host — the quiet host-tab dot's meaning.
 *  A finished agent idles in `waiting` ~forever, so "has any finished agent" would
 *  light the dot permanently (the bug); this is the UNSEEN subset instead:
 *    • while the host is ACTIVE (you're looking) it is empty — you've seen it;
 *    • it keeps only ids still finished (a finish that goes back to work, or
 *      escalates to asking, drops out);
 *    • it grows only by a FRESH background finish (a `waiting` a terminal just
 *      entered), never by the baseline discovery of already-finished agents.
 *  Pure and stateful-by-fold: the caller threads the previous set back in, together
 *  with the transition it ALREADY computed this frame (no re-diff here — the
 *  transition is the one source of truth for "what changed"). On the baseline
 *  `candidates` is empty, so nothing is added; no separate `prev === null` guard.
 *  Takes the raw `finishedIds` array and builds its lookup Set only AFTER the
 *  active-host early-return, so the frequently-ticking active host never allocates
 *  a Set it discards. */
export function nextUnseenFinished(
  unseen: ReadonlySet<TerminalId>,
  candidates: AttentionTransition["candidates"],
  finishedIds: readonly TerminalId[],
  isActiveHost: boolean,
): Set<TerminalId> {
  if (isActiveHost) return new Set(); // you're looking at it → nothing unseen.
  // Keep only ids still finished (drops ended + finished→asking).
  const finishedNow = new Set(finishedIds);
  const next = new Set<TerminalId>(
    [...unseen].filter((id) => finishedNow.has(id)),
  );
  for (const { id, asking } of candidates) {
    if (!asking) next.add(id); // a fresh background finish is unseen.
  }
  return next;
}
