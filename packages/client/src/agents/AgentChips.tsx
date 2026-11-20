import { type Component, For, Show } from "solid-js";
import type { AgentChip } from "@kolu/agent-distro/status";

const AgentChips: Component<{ chips: readonly AgentChip[] }> = (props) => (
  <Show when={props.chips.length > 0}>
    <div
      data-testid="agents-chips"
      class="mt-2 flex flex-wrap gap-1.5 text-[11px]"
    >
      <For each={props.chips}>
        {(chip) => (
          <span
            data-testid="agents-chip"
            data-agent={chip.title}
            title={
              chip.version === undefined
                ? chip.title
                : `${chip.title} ${chip.version}`
            }
            class="rounded-md border border-edge bg-surface-2 px-1.5 py-px font-mono whitespace-nowrap text-fg-2"
          >
            {chip.title}
            <Show when={chip.version}>
              {(version) => <span class="ml-1 text-fg-3/70">{version()}</span>}
            </Show>
          </span>
        )}
      </For>
    </div>
  </Show>
);

export default AgentChips;
