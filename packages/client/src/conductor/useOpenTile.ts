/** GO TO THAT TERMINAL — the conversation's ONE way out to a tile.
 *
 *  The Conductor names terminals in two places: a `create` card's "open tile"
 *  in the transcript, and the name on a watched row in the panel beside it.
 *  Both mean the same thing, so both are this function — the alternative is
 *  two navigations that agree today and drift the first time one of them
 *  learns something (a posture to restore, a tab the canvas must not leave).
 *
 *  It is a TAB SWITCH and then a focus, in that order. One conversation drives
 *  terminals on every machine, so the tile may be on a host whose tab is not
 *  the selected one: `selectHostTab` leaves the conversation and lands on that
 *  host's canvas in whatever posture it was left in (maximized stays
 *  maximized), and the focus then lands on the tile there. The same two steps,
 *  in the same order, a palette row or a notification click takes.
 *
 *  A hook and not a bare function because the focus half is one —
 *  `useDockFocus` reads the terminal store of the view it is called under, and
 *  that store is what tells a stale id from a live one. Call it in a component
 *  body, like any other. */

import { decodeHostKey } from "kolu-common/hostKey";
import type { TerminalId } from "kolu-common/surface";
import { useDockFocus } from "../canvas/dock/useDockFocus";
import { selectHostTab } from "../host/selectHostTab";

export function useOpenTile(): (at: {
  /** The ENCODED host key the terminal lives on (`local`, `remote:…`) — the
   *  host half of a fleet ref, exactly as the cell spells it. */
  readonly host: string;
  readonly id: TerminalId;
}) => void {
  const focus = useDockFocus();
  return (at) => {
    selectHostTab(decodeHostKey(at.host));
    focus(at.id);
  };
}
