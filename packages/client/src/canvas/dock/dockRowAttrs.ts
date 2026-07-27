/** The data-attribute contract every dock row surface carries — the hooks
 *  `index.css` styles rows through and the e2e suite selects them by.
 *
 *  It exists because that contract was hand-spelled in THREE components
 *  (`Dock.tsx`'s `DockRow`, `DockList.tsx`'s `DockListRow`, `SubAgentRow`) and
 *  held together by memory. The stylesheet keys on the SET — `[data-dock-row]`
 *  for the wash, `[data-asking]`/`[data-unread]` for its hue,
 *  `:not([data-active])` for its suppression — so a surface that spells five of
 *  the six is not a little wrong, it is silently outside a rule. That already
 *  happened twice: the split sub-entry set `data-asking` and lit up nowhere (it
 *  is the ONE row type that exists because its agent was invisible), and it
 *  omitted `data-active` entirely, which made the active-row suppression a
 *  no-op for it rather than a decision anyone took.
 *
 *  So `active` is REQUIRED, not optional: a surface with no notion of an active
 *  row says `active: false` out loud. An omitted field would be the same silence
 *  this exists to end.
 *
 *  Only the SHARED contract moves here. Each surface keeps its own `data-testid`,
 *  its geometry, its classes, its handlers, and the attributes genuinely local to
 *  it (`data-parent-id`, `data-sub-count`, `data-sleeping`) — those are not what
 *  the wash reads. */

import type { AgentInfo, TerminalId } from "kolu-common/surface";
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
 *  string would MATCH `[data-asking]` and wash a row that is not asking. */
export function dockRowAttrs(row: {
  id: TerminalId;
  /** The ORDER bucket (`data-bucket`) — ordering tests and the rail glow. */
  bucket: DockRowBucket;
  /** The agent state verbatim, for debugging and e2e assertions. */
  agentState: AgentInfo["state"] | undefined;
  /** Is this the row you are looking at — the wash's suppression. */
  active: boolean;
  /** Blocked on you. Comes off the ATTENTION class (the bound pip's `asking`),
   *  never the ORDER bucket: those are different folds that agreed only by
   *  luck. Violet needs-you dominates amber unread when both hold, which the
   *  stylesheet decides by declaration order. */
  asking: boolean;
  /** Finished work you have not opened. */
  unread: boolean;
}): DockRowAttrs {
  return {
    "data-dock-row": "",
    "data-terminal-id": row.id,
    "data-bucket": row.bucket,
    "data-agent-state": row.agentState,
    "data-active": row.active ? "" : undefined,
    "data-asking": row.asking ? "" : undefined,
    "data-unread": row.unread ? "" : undefined,
  };
}
