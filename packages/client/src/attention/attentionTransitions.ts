/** The PURE attention transition decision — the #1177-class logic of `useAttention`,
 *  kept in its own wire-free file so it is unit-testable without padiMap / the app
 *  owner. Given one host's previous `urgency` cell and its current one, it decides
 *  which terminals should chime and which ended their attention episode. */

import type { PadiUrgency } from "@kolu/padi/surface";
import type { TerminalId } from "kolu-common/surface";

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
  prev: PadiUrgency | null,
  cur: PadiUrgency,
): AttentionTransition {
  if (prev === null) return { candidates: [], ended: [] };

  const nextAsk = new Set(cur.awaitingIds);
  const nextFin = new Set(cur.finishedIds);
  const prevAsk = new Set(prev.awaitingIds);
  const prevFin = new Set(prev.finishedIds);

  const ended: TerminalId[] = [];
  for (const id of [...prevAsk, ...prevFin]) {
    if (!nextAsk.has(id) && !nextFin.has(id)) ended.push(id);
  }

  const candidates: Array<{ id: TerminalId; asking: boolean }> = [];
  for (const id of [...nextAsk, ...nextFin]) {
    const nowAsking = nextAsk.has(id);
    const wasAsking = prevAsk.has(id);
    const wasInClass = wasAsking || prevFin.has(id);
    if (!wasInClass || (nowAsking && !wasAsking)) {
      candidates.push({ id, asking: nowAsking });
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
 *  Pure and stateful-by-fold: the caller threads the previous set back in. */
export function nextUnseenFinished(
  unseen: ReadonlySet<TerminalId>,
  prev: PadiUrgency | null,
  cur: PadiUrgency,
  isActiveHost: boolean,
): Set<TerminalId> {
  if (isActiveHost) return new Set(); // you're looking at it → nothing unseen.
  const finishedNow = new Set(cur.finishedIds);
  // Keep only ids still finished (drops ended + finished→asking).
  const next = new Set<TerminalId>(
    [...unseen].filter((id) => finishedNow.has(id)),
  );
  // On the baseline `attentionTransitions` yields no candidates (a discovery is
  // not a transition), so nothing is added — no separate `prev === null` guard.
  for (const { id, asking } of attentionTransitions(prev, cur).candidates) {
    if (!asking) next.add(id); // a fresh background finish is unseen.
  }
  return next;
}
