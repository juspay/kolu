/** PR identity rung for dock rows. Mirrors the terminal title bar
 *  (TerminalMeta) so a row's compact PR badge — merge-state icon, CI
 *  status dot, `#N`, and the title — uses the same vocabulary the user
 *  sees on the focused tile. Returns null for unresolved PR kinds
 *  (`absent` / `pending` / `unavailable`) so the row collapses cleanly. */

import { prLabel } from "kolu-github/schemas";
import { type Component, Show } from "solid-js";
import type { TerminalMetadata } from "kolu-common/surface";
import ChecksIndicator from "../../terminal/ChecksIndicator";
import { PrStateIcon } from "../../ui/Icons";
import { resolvedPr } from "../dockModel";

const PrLine: Component<{
  meta: TerminalMetadata | undefined;
  /** Tailwind text-size class. Desktop dock uses `text-[0.65rem]`;
   *  mobile drawer bumps to `text-[0.7rem]` for thumb-friendly density. */
  textClass?: string;
}> = (props) => {
  const pr = () => (props.meta ? resolvedPr(props.meta.pr) : null);
  return (
    <Show when={pr()}>
      {(p) => (
        <div
          class={`flex items-center gap-1.5 min-w-0 text-fg-2 ${props.textClass ?? "text-[0.65rem]"}`}
          data-testid="dock-pr"
          title={prLabel(p())}
        >
          <PrStateIcon state={p().state} class="w-3 h-3" />
          <Show when={p().checks}>
            {(checks) => <ChecksIndicator status={checks()} />}
          </Show>
          <span class="font-mono tabular-nums text-fg-3 shrink-0">
            #{p().number}
          </span>
          <span class="truncate min-w-0">{p().title}</span>
        </div>
      )}
    </Show>
  );
};

export default PrLine;
