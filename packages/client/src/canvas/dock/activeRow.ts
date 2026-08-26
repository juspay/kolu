/** "Is this the row the user is LOOKING at?" — the ONE spelling of the answer.
 *
 *  It reads the TILE registry, not the terminal store: a focused sleeping tile
 *  reads as the active row. That two-clause formula used to live inside
 *  `dockRowAttrs`, precisely so no call site could get it wrong — and the
 *  comment there said so: "a value a call site assembles is a value a call site
 *  can get wrong".
 *
 *  The attribute builder is now in `@kolu/solid-dockrow`, which cannot see
 *  kolu's tile registry — that is app-ambient state, and the row package takes
 *  plain values. So the READ hoists to the call sites while the ANSWER stays
 *  single-sourced here: every dock row surface passes `isActiveRow(id)` and none
 *  of them re-derives it. Called from a component body, like every other
 *  reactive read. */

import type { TerminalId } from "kolu-common/surface";
import { useTileStore } from "../../tile/useTileStore";

export function isActiveRow(id: TerminalId): boolean {
  const tileStore = useTileStore();
  return tileStore.isActiveTile(id) || tileStore.isFocused(id);
}
