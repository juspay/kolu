/** Presence pips that ride on every dock row.
 *
 *  Two independent change axes share this file because each
 *  produces a small JSX cell consumed identically by both the
 *  desktop dock and the mobile drawer. The file groups them so the
 *  two callers can `import { PrPip, SubCountCell }`
 *  rather than reach into separate single-export modules:
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
 *    - `SubCountCell` (sub-terminal chip wrapper) — last grid
 *      column of line 1 when present. Empty span collapses the
 *      column to 0 when the row has no sub-terminals, giving the
 *      width back to the branch label. Volatility axis: sub-
 *      terminal presence visualization (low-volatility today).
 *
 *  The live-output presence axis used to live here too, as
 *  `ActivityPip` (a standalone green dot in its own leading column);
 *  R-activity-merge folded that dot into the row's `StatePip` as its
 *  green live RING, so there is no separate activity cell anymore.
 *
 *  Each export could be split into its own file the moment one of
 *  these axes diverges enough to justify the boundary; for now
 *  the location grouping is honest because the file is small and
 *  the two pieces are consumed together. The file name is
 *  `RowPips` (a noun for the thing) rather than `RowIcons` (a
 *  noun for the file). */

import {
  activePr,
  type TerminalId,
  type TerminalMetadata,
} from "kolu-common/surface";
import type { PrInfo } from "anyforge/schemas";
import { type Component, createMemo, Show } from "solid-js";
import ChecksIndicator from "../../terminal/ChecksIndicator";
import { prTooltip } from "../../terminal/prTooltip";
import type { TerminalDisplayInfo } from "../../terminal/terminalDisplay";
import { useTerminalStore } from "../../terminal/useTerminalStore";
import { PrStateIcon } from "../../ui/Icons";
import { SubCountChip } from "./SubCountChip";

/** Per-row combined reactive data — `info` + `meta` in a single memo.
 *  Three components (`DockRow`, `RailChip`, `DockListRow`) build the same
 *  `createMemo(() => { const info = …; const meta = …; … })` pattern.
 *  This factory extracts that once: call it in a component body,
 *  read the accessor to get `{ info, meta }` or `null`. */
export function createDockRowData(
  id: TerminalId,
): () => { info: TerminalDisplayInfo; meta: TerminalMetadata } | null {
  const store = useTerminalStore();
  return createMemo(() => {
    const info = store.getDisplayInfo(id);
    const meta = store.getMetadata(id);
    if (!info || !meta) return null;
    return { info, meta };
  });
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

/** Sub-count cell — grid cell on line 1. Empty span collapses to 0
 *  width when this row has no sub-terminals, so the column gives
 *  its width back to the branch label. */
export const SubCountCell: Component<{ subCount: number }> = (props) => (
  <span class="flex items-center justify-end">
    <Show when={props.subCount > 0}>
      <SubCountChip count={props.subCount} testId="dock-sub-count" />
    </Show>
  </span>
);
