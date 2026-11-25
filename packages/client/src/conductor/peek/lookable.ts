/** IS THERE A SCREEN TO LOOK AT — the one gate a Conductor screen and the head
 *  above it share (`LivePane.tsx`, `TerminalPeek.tsx`, `TerminalHead.tsx`),
 *  HELD across a standing that cannot vouch either way.
 *
 *  `gone`, and `here` with no active arm (a sleeping terminal), are ANSWERS:
 *  there is no screen, and the pane says so. `loading` and `unreachable` are
 *  the fleet index saying it CANNOT SAY — a per-key view that has not had its
 *  first frame, a host still adopting its census, a socket that dropped
 *  (`palette/fleetTerminals.ts`).
 *
 *  A screen is not torn down on one of those. It costs the reader everything:
 *  the xterm goes, and with it its scrollback and the place they had scrolled
 *  to, and the attach is opened again at the bottom. Under Solid 1 the gate
 *  could gate on the instantaneous standing because a view's first read
 *  recomputed before the frame was drawn; under Solid 2 a view read in the
 *  frame it was created answers with its committed value — nothing — until
 *  the flush, so a `loading` frame is newly reachable in a pane that has been
 *  live for minutes. The gate therefore keeps what it had until the index
 *  answers again. */

import { type Accessor, createMemo } from "solid-js";
import type { FleetTerminalStanding } from "../../palette/fleetTerminals";
import { liveArm } from "../terminalStatus";

export function createLookable(
  standing: Accessor<FleetTerminalStanding>,
): Accessor<boolean> {
  return createMemo((was: boolean = false) => {
    const now = standing();
    return now.kind === "loading" || now.kind === "unreachable"
      ? was
      : liveArm(now) !== undefined;
  });
}
