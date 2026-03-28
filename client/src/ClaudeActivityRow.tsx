/** Shared row showing Claude Code status and activity sparkline.
 *  Used in both the Sidebar and Mission Control to keep display consistent. */

import { type Component, Show } from "solid-js";
import ClaudeIndicator from "./ClaudeIndicator";
import ActivityGraph from "./ActivityGraph";
import type { ClaudeCodeInfo } from "kolu-common";
import type { ActivitySample } from "./useTerminals";

const ClaudeActivityRow: Component<{
  claude: ClaudeCodeInfo | null | undefined;
  activityHistory: ActivitySample[];
}> = (props) => (
  <Show when={props.claude || props.activityHistory.length > 0}>
    <div class="flex items-center gap-1.5 mt-0.5">
      <Show when={props.claude}>
        {(claude) => <ClaudeIndicator state={claude().state} />}
      </Show>
      <Show when={props.activityHistory.length > 0}>
        <div class="ml-auto">
          <ActivityGraph samples={props.activityHistory} />
        </div>
      </Show>
    </div>
  </Show>
);

export default ClaudeActivityRow;
