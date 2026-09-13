/** The mark on a listener no terminal's subtree holds, shown where a terminal
 *  printed its URL — the Ports row and the printed-URL card say it the same way. */

import type { Component } from "solid-js";

export const DetachedBadge: Component<{ testid: string }> = (props) => (
  <span
    class="shrink-0 rounded bg-amber-500/15 px-1 text-[10px] font-medium text-amber-800 dark:text-amber-300"
    data-testid={props.testid}
    title="served by a process that left every terminal"
  >
    detached
  </span>
);
