/** Presence pips that ride on every dock row.
 *
 *  Two independent change axes share this file because each
 *  produces a small JSX cell consumed identically by both the
 *  desktop dock and the mobile drawer. The file groups them so the
 *  two callers can import the same PR presentation rather than hand-spell it:
 *
 *    - `PrPip` (PR state + checks tooltip) — leading glyph on
 *      row line 2. Inline, not a grid cell: wherever the caller
 *      puts it, the PR icon sits at that X. The desktop and
 *      mobile docks both place it at the left edge of line 2 so
 *      PR pips align across sections regardless of how the
 *      right-side columns sized themselves. The `<a>` is a real
 *      link to `pr.url` (Cmd-click opens GitHub directly); the
 *      row's outer click handler doesn't intercept
 *      (stopPropagation). Tooltip via `prTooltip` carries the
 *      multi-line checks breakdown. Volatility axis: PR display
 *      composition (changed when `prTooltip` was unified).
 *  Live-output presence no longer has its own cell — activity is the
 *  StatePip motion channel (spin/glow), so the row leading column is
 *  identity + paint + motion + alert only.
 *
 *  Each export could be split into its own file the moment one of
 *  these axes diverges enough to justify the boundary; for now
 *  the location grouping is honest because the file is small and
 *  the two pieces are consumed together. The file name is
 *  `RowPips` (a noun for the thing) rather than `RowIcons` (a
 *  noun for the file). */

import { activePr, type TerminalMetadata } from "@kolu/padi/surface";
import type { PrInfo } from "anyforge/schemas";
import type { TerminalId } from "kolu-common/surface";
import { type Component, createMemo, Show } from "solid-js";
import ChecksIndicator from "../../terminal/ChecksIndicator";
import { prTooltip } from "../../terminal/prTooltip";
import {
  pairDisplayRow,
  type TerminalDisplayInfo,
} from "../../terminal/terminalDisplay";
import { useTerminalStore } from "../../terminal/useTerminalStore";
import { PrStateIcon } from "../../ui/Icons";

/** Per-row combined reactive data — `info` + `meta` in a single memo.
 *  Three components (`DockRow`, `RailChip`, `DockListRow`) build the same
 *  `createMemo(() => { const info = …; const meta = …; … })` pattern.
 *  This factory extracts that once: call it in a component body,
 *  read the accessor to get `{ info, meta }` or `null`. */
export function createDockRowData(
  id: TerminalId,
): () => { info: TerminalDisplayInfo; meta: TerminalMetadata } | null {
  const store = useTerminalStore();
  return createMemo(() =>
    pairDisplayRow(store.getDisplayInfo(id), store.getMetadata(id)),
  );
}

/** Inline PR pip — leading glyph on row line 2. Caller controls
 *  layout (typically a flex container alongside the subline text).
 *  Renders nothing when there's no PR. */
export const PrPip: Component<{ meta: TerminalMetadata }> = (props) => {
  // sleeping/absent → no live PR resolution → no pill
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
          onClick={(e) => e.stopPropagation()}
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
