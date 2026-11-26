/** `createBootPick` — ONE host's DERIVED first active tile.
 *
 *  The tile a cold boot lands on is a FUNCTION of the host's hydration census:
 *  the terminal list, each listed terminal's composed record (so the walk to a
 *  top-level tile is the one the canvas paints), the persisted saved-session
 *  marker, and a deep link's focus intent. It is not news that arrives — it is
 *  an answer derivable from state that is already here, so it is a memo, read
 *  through `createViewState`'s focus derivation, and NOT a signal the session-
 *  restore effect seeds.
 *
 *  That matters beyond tidiness. Seeding it from the hydration effect made that
 *  effect read the metadata census and write the focus signal the canvas, the
 *  app shell and the command palette all read — an EFFECT RELAY: Solid grades it
 *  a tear, and the user sees the extra boot frame it names, one paint with no
 *  active tile before the seed lands. Derived here, the active tile is already
 *  the picked one in the very flush hydration runs in.
 *
 *  The rule is `useSessionRestore`'s `picked`, to the letter — the seed still
 *  computes it to drive its own side effects (the visit trail, the host's
 *  active-terminal report), and the two must never disagree:
 *   - every listed terminal's record must have arrived, and none may be PARKED
 *     (a reboot's restore-card rows are not tiles) — otherwise there is no pick
 *     yet, exactly as hydration defers;
 *   - the saved-session cell must have yielded, or a list that lands first would
 *     pick the first tile over the one the user left active;
 *   - a deep link's target tile wins, then the persisted marker, then the first
 *     tile in the server's order.
 *
 *  What this memo CANNOT see is the answer `session.restore` gives for an
 *  in-session restore: that fact is parked non-reactively on the host's restore
 *  latch. Hydration covers it — a pick the derivation does not already show is
 *  written through the ordinary focus path (`createViewState.seedCovers`). */

import { tileTerminalOf } from "@kolu/padi-client/surface";
import type { TerminalId } from "kolu-common/surface";
import { type Accessor, createMemo } from "solid-js";
import { deepLinkFocusIntent } from "../deepLinkFocusIntent";
import { containingTileOf, type ParentEdge } from "../terminal/terminalTree";
import type { HostWire } from "./createHostWire";

export function createBootPick(wire: HostWire): Accessor<TerminalId | null> {
  return createMemo<TerminalId | null>(() => {
    const keys = wire.terminalKeys();
    if (keys === undefined || keys.length === 0) return null;
    // The census, in the server's Map insertion order — the canonical ordering
    // the first-tile fallback and the tab strip both key on.
    const parents = new Map<TerminalId, TerminalId | null>();
    for (const id of keys) {
      const record = tileTerminalOf(wire.terminals.byKey(id)?.());
      // Not arrived, or parked: no honest pick yet. (Both read as `undefined`
      // here for the same reason hydration waits on both.)
      if (record === undefined) return null;
      parents.set(id, record.parentId ?? null);
    }
    if (wire.session.sub.pending()) return null;
    const parentEdge: ParentEdge = (id) => parents.get(id);
    // Top-level = root of its own chain; a cycle member or orphan is painted
    // top-level too, exactly as `terminalIds` paints it.
    const topIds = keys.filter((id) => containingTileOf(id, parentEdge) === id);
    const intent = deepLinkFocusIntent();
    const intentTile =
      intent === null ? null : containingTileOf(intent, parentEdge);
    if (intentTile !== null && topIds.includes(intentTile)) return intentTile;
    const saved = wire.session.value()?.activeTerminalId ?? null;
    if (saved !== null && topIds.includes(saved as TerminalId))
      return saved as TerminalId;
    return topIds[0] ?? null;
  });
}
