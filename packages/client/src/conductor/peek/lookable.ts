/** IS THERE A SCREEN TO LOOK AT — the one gate a Conductor screen and the head
 *  above it share. It is computed ONCE per screen, by the view that owns the
 *  screen (`LivePane.tsx`, `TerminalPeek.tsx`), and handed to the head
 *  (`TerminalHead.tsx`) as a prop: two latches over one screen could disagree,
 *  and a head that answered `false` while its pane still drew the xterm would
 *  show a screen with no readout over it.
 *
 *  `gone`, `unreachable`, and `here` with no active arm (a sleeping terminal),
 *  are ANSWERS: there is no screen, and the pane says so — an unreachable host
 *  is the client's own host-map fact, it lasts as long as the outage, and
 *  keeping a dead xterm up through it would leave the key bar sending keys to
 *  a host that is down.
 *
 *  `loading` is the fleet index saying it CANNOT SAY — a per-key view that has
 *  not had its first frame, a host still adopting its census
 *  (`palette/fleetTerminals.ts`). The gate HOLDS what it had across that one,
 *  because tearing a screen down costs the reader everything: the xterm goes,
 *  and with it its scrollback and the place they had scrolled to, and the
 *  attach is opened again at the bottom.
 *
 *  This is HARDENING against a non-answer, not the fix for any known
 *  teardown. Under Solid 1 the gate could gate on the instantaneous standing
 *  because a view's first read recomputed before the frame was drawn; under
 *  Solid 2 a view read in the frame it was created answers with its committed
 *  value — nothing — until the flush, so a `loading` frame is reachable where
 *  it was not. */

import { type Accessor, createMemo } from "solid-js";
import type { FleetTerminalStanding } from "../../palette/fleetTerminals";
import { liveArm } from "../terminalStatus";

export function createLookable(
  standing: Accessor<FleetTerminalStanding>,
): Accessor<boolean> {
  return createMemo((was: boolean = false) => {
    const now = standing();
    return now.kind === "loading" ? was : liveArm(now) !== undefined;
  });
}
