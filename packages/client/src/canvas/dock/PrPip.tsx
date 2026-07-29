/** Pull-request presentation carried on desktop and touch Dock rows. */

import { activePr, type TerminalMetadata } from "@kolu/padi/surface";
import type { PrInfo } from "anyforge/schemas";
import { type Component, Show } from "solid-js";
import ChecksIndicator from "../../terminal/ChecksIndicator";
import { prTooltip } from "../../terminal/prTooltip";
import { PrStateIcon } from "../../ui/Icons";

/** Inline PR pip — a real link so modified click and the context menu retain
 * browser semantics. The caller owns its position in the row. */
export const PrPip: Component<{ meta: TerminalMetadata }> = (props) => {
  const pr = (): PrInfo | null => activePr(props.meta);
  return (
    <Show when={pr()}>
      {(p) => (
        <a
          href={p().url}
          target="_blank"
          rel="noopener noreferrer"
          data-testid="dock-row-pr-pip"
          class="flex items-center gap-1 text-fg-3 hover:text-fg transition-colors shrink-0"
          title={prTooltip(p())}
          onClick={(event) => event.stopPropagation()}
        >
          <PrStateIcon state={p().state} class="w-3 h-3" />
          <Show when={p().checks}>
            {(checks) => <ChecksIndicator status={checks()} />}
          </Show>
        </a>
      )}
    </Show>
  );
};
