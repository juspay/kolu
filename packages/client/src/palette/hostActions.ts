/** Host → palette projection — the host rows of the root index and the Hosts
 *  scoped group (⌘⇧H). Apart from the terminal rows (`fleetActions`) because a
 *  host row needs only the host's label, its connection and the switch trail —
 *  never the fleet's terminals. */

import {
  encodeHostKey,
  type HostKey,
  hostKeysEqual as sameHost,
} from "kolu-common/hostKey";
import type { PaletteAction } from "../CommandPalette";
import { hostLabel, hostRowContext } from "../host/hostChipTone";
import { hostRecency, switchedAtOf } from "../host/hostRecency";
import { padiMap } from "../wire";

/** Host rows for root index and the Hosts scoped group — one source of truth.
 *
 *  Order stays membership order (a host list that reshuffles under the cursor
 *  is not a list you can learn); it is `visitedAt` that carries the switch
 *  trail, so ⌘⇧H's default highlight lands on the host you came from — the same
 *  `defaultSelectionIndex` rule the terminal rows feed with their own visit
 *  trail, through the same field. The stamp itself comes from the trail's own
 *  lookup (`hostRecency.switchedAtOf`), the mirror of `visitedAtOf`.
 *
 *  A host row carries no activity clock to pair the visit stamp with, and that
 *  asymmetry is the design: the Hosts list keeps POOL order, because a machine
 *  list that reshuffles under the cursor is unlearnable — the same reason the
 *  dock stopped sorting on a clock. So a host's warmth (`rootIndex.rankOf`)
 *  degenerates to its visit stamp, which is harmless because no path ever
 *  rank-sorts hosts. */
export function hostRootActions(
  hosts: HostKey[],
  active: HostKey,
  switchHost: (host: HostKey) => void,
): PaletteAction[] {
  // Read the trail ONCE, not per row: Solid does not dedupe repeated reads, so
  // a read inside the map would register one subscription per host on a memo
  // that recomputes on fleet, pool, and posture churn alike.
  const trail = hostRecency();
  return hosts.map((h): PaletteAction => {
    const label = hostLabel(h);
    const state = padiMap.entry(h).state();
    const context = hostRowContext(state, sameHost(h, active));
    return {
      kind: "action",
      name: label,
      description: context || undefined,
      onSelect: () => {
        if (!sameHost(h, active)) switchHost(h);
      },
      row: {
        kind: "host",
        hostKey: h,
        context,
        visitedAt: switchedAtOf(trail, encodeHostKey(h)),
        searchText: `${label} ${context} ${state.kind}`.trim(),
      },
    };
  });
}
