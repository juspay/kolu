/** IS A ROW DROP EVEN POSSIBLE — the question the re-home tip waits for.
 *
 *  A repo card has to hold two LIVE TOP-LEVEL rows before a row can be dropped
 *  on another. Top-level, not "any two live rows": a card with one tile and its
 *  own split has no legal pair at all (child→its parent and parent→its
 *  descendant are both refusals), and a banner that teaches a gesture the card
 *  cannot perform is the same lie the hover verdict exists to avoid. Live, not
 *  merely listed: a sleeping row has no grip.
 *
 *  It takes the LIVE TILE LIST rather than a metadata reader, which is the
 *  whole reason it is its own function. `.filter` does not short-circuit, so a
 *  reader asking each row's record subscribed the tip's effect to two store
 *  leaves per row of every card it had to look at — past Solid's 200-source
 *  `WIDE_SCOPE_DEPS` judge at about 67 rows. The store folds that question once
 *  (`useTerminalStore.liveTileIds`); this is a plain set membership over the
 *  answer. */

import type { TerminalId } from "kolu-common/surface";
import type { DockTree } from "./dockTree";

export function rehomePairPossible(
  tree: DockTree,
  liveTileIds: readonly TerminalId[],
): boolean {
  const live = new Set(liveTileIds);
  return tree.groups.some(
    (group) => group.topRows.filter((row) => live.has(row.id)).length >= 2,
  );
}
