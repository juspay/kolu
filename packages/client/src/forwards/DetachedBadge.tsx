/** The mark on a listener no terminal's subtree holds, shown where a terminal
 *  printed its URL — the Ports row and the printed-URL card say it the same way,
 *  in the Inspector's own status-chip vocabulary. */

import type { Component } from "solid-js";
import Chip from "../ui/Chip";

export const DetachedBadge: Component<{ testid: string }> = (props) => (
  <Chip
    tone="warning"
    title="served by a process that left every terminal"
    data-testid={props.testid}
  >
    detached
  </Chip>
);
