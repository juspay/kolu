/** The host-tab dot's meaning — the "unseen finished" fold, kept in its own
 *  wire-free file so it is unit-testable without padiMap / the app owner.
 *
 *  Its sibling, the pure attention TRANSITION decision, graduated to
 *  `@kolu/terminal-vocab/attentionTransitions` when padi became its second
 *  consumer (supervision-edge delivery fires on the same edge this app fires
 *  sound + OS popup on). This fold stayed behind deliberately: "have you LOOKED
 *  at this host" is a browser-viewport question with no meaning on a daemon. */

import type { AttentionTransition, TerminalId } from "kolu-common/surface";

/** The next "unseen finished" set for ONE host — the quiet host-tab dot's meaning.
 *  A finished agent idles in `waiting` ~forever, so "has any finished agent" would
 *  light the dot permanently (the bug); this is the UNSEEN subset instead:
 *    • while the host is ACTIVE (you're looking) it is empty — you've seen it;
 *    • it keeps only ids still finished (a finish that goes back to work, or
 *      escalates to asking, drops out);
 *    • it grows only by a FRESH background finish (a `waiting` a terminal just
 *      entered), never by the baseline discovery of already-finished agents;
 *    • a terminal the Conductor drives (`isDriven`) is never in it: its fresh
 *      finish is not added, and an id that is driven now drops out — which is
 *      also what keeps a set saved by an earlier page from bringing it back.
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
  isDriven: (id: TerminalId) => boolean,
): Set<TerminalId> {
  if (isActiveHost) return new Set(); // you're looking at it → nothing unseen.
  // Keep only ids still finished (drops ended + finished→asking) and not driven.
  const finishedNow = new Set(finishedIds);
  const next = new Set<TerminalId>(
    [...unseen].filter((id) => finishedNow.has(id) && !isDriven(id)),
  );
  for (const { id, asking } of candidates) {
    // A fresh background finish is unseen, unless the Conductor reads it.
    if (!asking && !isDriven(id)) next.add(id);
  }
  return next;
}
