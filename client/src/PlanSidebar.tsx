/** PlanSidebar — plan file list shown below terminals in the sidebar. */

import { type Component, Show, For } from "solid-js";
import Tooltip from "@corvu/tooltip";
import type { PlanFile } from "kolu-common";

/** Format a timestamp as a relative time string (e.g. "2m ago", "1h ago"). */
function relativeTime(epochMs: number): string {
  const delta = Date.now() - epochMs;
  const seconds = Math.floor(delta / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

const PlanSidebar: Component<{
  plans: PlanFile[];
  activePlanPath: string | null;
  onSelect: (path: string) => void;
}> = (props) => {
  return (
    <Show when={props.plans.length > 0}>
      <div class="border-t border-edge">
        <div class="px-2 py-1.5 text-xs font-medium text-fg-3 uppercase tracking-wider">
          Plans
        </div>
        <For each={props.plans}>
          {(plan) => (
            <Tooltip placement="right" openDelay={400}>
              <Tooltip.Trigger
                as="button"
                data-testid="plan-entry"
                data-active={
                  props.activePlanPath === plan.path ? "" : undefined
                }
                class="w-full px-2 py-1.5 text-sm text-left transition-colors border-b border-edge"
                classList={{
                  "bg-accent/10 text-fg border-l-4 border-l-accent":
                    props.activePlanPath === plan.path,
                  "text-fg-3 hover:text-fg-2 hover:bg-surface-2":
                    props.activePlanPath !== plan.path,
                }}
                onClick={() => props.onSelect(plan.path)}
              >
                <div class="truncate">{plan.name}</div>
                <div class="text-xs text-fg-3 mt-0.5">
                  {relativeTime(plan.modifiedAt)}
                </div>
              </Tooltip.Trigger>
              <Tooltip.Portal>
                <Tooltip.Content class="bg-surface-2 text-fg text-xs px-2 py-1 rounded border border-edge shadow-lg z-50">
                  {plan.path}
                </Tooltip.Content>
              </Tooltip.Portal>
            </Tooltip>
          )}
        </For>
      </div>
    </Show>
  );
};

export default PlanSidebar;
