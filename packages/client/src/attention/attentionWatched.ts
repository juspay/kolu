import type { TerminalId } from "kolu-common/surface";

/** IS THIS TERMINAL IN FRONT OF THE PERSON — the one question that decides
 *  both whether a mark is raised on it and whether a ping on it is seen.
 *  Three cases:
 *
 *  - the canvas is on screen, and it is the shown host's focused pane — the
 *    terminal actually receiving input, a split rather than its tile;
 *  - the Conductor is on screen, and Look is on this terminal;
 *  - the Conductor is on screen, and this terminal's screen shows in a live
 *    pane of the picked work's Terminals view.
 *
 *  The last two are one fact — a screen of it is showing in the Conductor
 *  (`./conductorScreens.ts`) — since Look and a live pane draw one screen
 *  part. While the Conductor is on screen, the shown host's focused pane is
 *  NOT in front: the Conductor covers it. */
export function isInFront(at: {
  canvasShown: boolean;
  activeHost: boolean;
  id: TerminalId;
  focusedId: TerminalId | null;
  screenShowing: boolean;
}): boolean {
  return (
    (at.canvasShown && at.activeHost && at.id === at.focusedId) ||
    at.screenShowing
  );
}
