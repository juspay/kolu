/**
 * Which attach attempt owes its first snapshot a REPAINT FROM SCRATCH.
 *
 * Revealing a pane must not blank it. The gate ends the attach when a pane is
 * hidden (`shownPane.ts`), so the reveal opens a new one and is answered with a
 * fresh snapshot — but the screen the hide left behind is still the last thing
 * the user saw, and it is a better thing to look at than nothing. Clearing the
 * terminal at OPEN trades a stale screen for a blank one for the whole
 * round-trip: on a phone that is a flash of black on every tile switch, and in
 * a background split tab the same. So the reset and the snapshot must land
 * TOGETHER, as one write.
 *
 * The client already handles exactly that frame: padi's overflow re-attach
 * sends `TERMINAL_RESET + snapshot` as one frame, and the backfill controller
 * is told a leading RIS is coming so the frame's own reset does not read as an
 * invalidation that revokes its re-seed (F11). An INITIAL attach's snapshot
 * carries no RIS — nothing upstream knows a reveal happened — so the reveal has
 * to supply one itself and make its first frame look like the frame the client
 * already paints correctly.
 *
 * That is the whole decision this module holds, lifted out of `Terminal.tsx`
 * for the reason `publishGrid.ts` and `foreignGrid.ts` were: the policy is one
 * rule about one bit, and the pane's frame handler cannot be driven by a test
 * without an xterm. ONE rule, not two: the pane's FIRST attach takes this road
 * as well, because a RIS onto an empty terminal paints nothing — the cost of
 * the uniform rule is a no-op, and the alternative is a second case to keep
 * true.
 *
 * It is one-shot per ATTEMPT, and per attempt is the point. A reveal arms the
 * open it is about to make; that open takes the mark, so nothing is left armed
 * for a later attach that has its own reason to exist. Within the armed
 * attempt only the FIRST snapshot repaints: a mid-stream overflow re-attach
 * carries its own RIS and is not the reveal's business, and prepending a second
 * one would blank a screen the user is reading. The reopen lanes that reset the
 * terminal by hand (a transport re-subscribe, a stale-grid reopen) arm nothing
 * — they have already blanked it, and they do so for a pane that is looking at
 * bytes it must not keep.
 */

export interface RevealRepaint {
  /** A reveal is about to open an attach: the FIRST snapshot of THAT attach
   *  must repaint from scratch. */
  armReveal(): void;
  /** An attach attempt is opening. It consumes whatever is armed — leaving
   *  nothing for the next attempt — and gets its own one-shot: "must this
   *  snapshot frame carry a leading reset?", true at most once. */
  openAttempt(): () => boolean;
}

export function createRevealRepaint(): RevealRepaint {
  /** Set by a reveal, spent by the very next open. */
  let armed = false;
  return {
    armReveal() {
      armed = true;
    },
    openAttempt() {
      let owed = armed;
      armed = false;
      return () => {
        if (!owed) return false;
        owed = false;
        return true;
      };
    },
  };
}
