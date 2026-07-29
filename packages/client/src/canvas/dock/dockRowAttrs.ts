/** The data-attribute contract every dock row surface carries — the hooks
 *  `index.css` styles rows through and the e2e suite selects them by.
 *
 *  It exists because that contract was hand-spelled in each row component
 *  (`Dock.tsx`'s `DockRow`, `DockList.tsx`'s `DockListRow`) and held together by
 *  memory. The stylesheet keys on the SET — `[data-dock-row]` for the wash,
 *  `[data-asking]`/`[data-unread]` for its hue, `:not([data-active])` for its
 *  suppression — so a surface that spells five of the six is not a little
 *  wrong, it is silently outside a rule.
 *
 *  Only the SHARED contract moves here. Each surface keeps its own `data-testid`,
 *  its geometry, its classes, its handlers, and the attributes genuinely local to
 *  it (`data-sub-count`, `data-sleeping`) — those are not what
 *  the wash reads. */

import type { AgentInfo, TerminalId } from "kolu-common/surface";
import { useTileStore } from "../../tile/useTileStore";
import type { DockRowBucket } from "./dockRowRanking";

export type DockRowAttrs = {
  "data-dock-row": "";
  "data-terminal-id": TerminalId;
  "data-bucket": DockRowBucket;
  "data-agent-state": AgentInfo["state"] | undefined;
  "data-active": "" | undefined;
  "data-asking": "" | undefined;
  "data-unread": "" | undefined;
};

/** Build one row's shared attribute bag. Booleans render as the empty-string
 *  attribute or as `undefined` (absent) — CSS tests presence, so a `"false"`
 *  string would MATCH `[data-asking]` and wash a row that is not asking.
 *
 *  There is deliberately NO `active` parameter. It used to take one, and every
 *  row worked the answer out for itself — a value a call site assembles is a
 *  value a call site can get wrong. Reading the tile registry here means a
 *  caller cannot supply a wrong answer, because there is no longer an answer to
 *  supply. Called from a component body, like every other reactive read here. */
export function dockRowAttrs(row: {
  id: TerminalId;
  /** The ORDER bucket (`data-bucket`) — ordering tests and the rail glow. */
  bucket: DockRowBucket;
  /** The agent state verbatim, for debugging and e2e assertions. */
  agentState: AgentInfo["state"] | undefined;
  /** Blocked on you. Comes off the ATTENTION class (the bound pip's `asking`),
   *  never the ORDER bucket: those are different folds that agreed only by
   *  luck. Violet needs-you dominates amber unread when both hold, which the
   *  stylesheet decides by declaration order. */
  asking: boolean;
  /** Finished work you have not opened. */
  unread: boolean;
}): DockRowAttrs {
  const tileStore = useTileStore();
  return {
    "data-dock-row": "",
    "data-terminal-id": row.id,
    "data-bucket": row.bucket,
    "data-agent-state": row.agentState,
    "data-active": tileStore.isActiveTile(row.id) ? "" : undefined,
    "data-asking": row.asking ? "" : undefined,
    "data-unread": row.unread ? "" : undefined,
  };
}
