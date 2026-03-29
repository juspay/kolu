/** Renders the appropriate indicator for an active process.
 *  Claude variant gets the rich animated indicator; generic shows the process name. */

import type { Component } from "solid-js";
import { Show } from "solid-js";
import type { ProcessInfo } from "kolu-common";
import ClaudeIndicator from "./ClaudeIndicator";

const ProcessIndicator: Component<{ process: ProcessInfo }> = (props) => (
  <Show
    when={props.process.kind === "claude" ? props.process : undefined}
    fallback={
      <span class="text-xs text-fg-3 truncate" data-testid="process-indicator">
        {props.process.name}
      </span>
    }
  >
    {(claude) => <ClaudeIndicator state={claude().state} />}
  </Show>
);

export default ProcessIndicator;
