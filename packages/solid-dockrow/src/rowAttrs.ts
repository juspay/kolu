/** The data-attribute contract every dock row surface carries — the hooks
 *  `dockrow.css` styles rows through and an e2e suite selects them by.
 *
 *  It exists because that contract was hand-spelled in each row component and
 *  held together by memory. The stylesheet keys on the SET —
 *  `[data-dock-row]` for the wash, `[data-asking]`/`[data-unread]` for its hue,
 *  `:not([data-active])` for its suppression — so a surface that spells five of
 *  the six is not a little wrong, it is silently outside a rule.
 *
 *  Only the SHARED contract is here. Each surface keeps its own `data-testid`,
 *  its geometry, its handlers, and the attributes genuinely local to it
 *  (`data-parent-id`, `data-tile-id`) — those are not what the wash reads. */

import type { TerminalId } from "@kolu/terminal-vocab/schema";
import type { DockRowBucket } from "./pipBind.ts";

export type DockRowAttrs = {
  "data-dock-row": "";
  "data-terminal-id": TerminalId;
  "data-bucket": DockRowBucket;
  "data-agent-state": string | undefined;
  "data-active": "" | undefined;
  "data-asking": "" | undefined;
  "data-unread": "" | undefined;
};

/** Build one row's shared attribute bag. Booleans render as the empty-string
 *  attribute or as `undefined` (absent) — CSS tests presence, so a `"false"`
 *  string would MATCH `[data-asking]` and wash a row that is not asking.
 *
 *  `active` arrives as a VALUE here where it used to be read in-place off
 *  kolu's tile registry. That read is ambient app state no package can see, so
 *  it hoists — but the guarantee it was protecting ("a value a call site
 *  assembles is a value a call site can get wrong") is kept the same way it
 *  always was, by there being ONE spelling of the answer: kolu-client's
 *  `isActiveRow`, which every dock call site passes and none re-derives. */
export function dockRowAttrs(row: {
  id: TerminalId;
  /** The ORDER bucket (`data-bucket`) — ordering tests and the rail glow. */
  bucket: DockRowBucket;
  /** The agent state VERBATIM.
   *
   *  A plain `string`, deliberately: a consumer whose wire carries agent state
   *  as text narrows it with `narrowAgentState` for the folds that need the
   *  closed literal, and passes the raw word HERE, recognised or not. Printing
   *  an unfamiliar state is more honest than dropping it, and this attribute is
   *  read (debug, e2e), never switched over. */
  agentState: string | undefined;
  /** Blocked on you. Comes off the ATTENTION class (the bound pip's `asking`),
   *  never the ORDER bucket: those are different folds that agreed only by
   *  luck. Violet needs-you dominates amber unread when both hold, which the
   *  stylesheet decides by declaration order. */
  asking: boolean;
  /** Finished work you have not opened. */
  unread: boolean;
  /** The row the user is LOOKING at — its highlight wins over an obligation
   *  they are already discharging. An OPTIONAL fact: a surface with no notion
   *  of an active tile simply never sets it, and every row reads unwashed by
   *  the active rule rather than wrongly. */
  active: boolean;
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
