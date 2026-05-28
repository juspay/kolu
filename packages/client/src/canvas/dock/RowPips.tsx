/** Presence pips that ride on every dock row.
 *
 *  Three independent change axes share this file because each
 *  produces a small JSX cell consumed identically by both the
 *  desktop dock and the mobile drawer. The file groups them so the
 *  two callers can `import { StatePip, PrPip, SubCountCell }`
 *  rather than reach into three single-export modules:
 *
 *    - `StatePip` (row-state-only visualization) — first grid
 *      column. Always renders a cell so subgrid placement stays
 *      stable; renders nothing inside for `none`/`parked`. Shape
 *      itself encodes the state, not color or animation alone:
 *      filled disk (needs attention — unread fresh transition),
 *      dim small disk (awaiting, already seen — lingering),
 *      hollow spinning ring (working), tiny muted dot (idle).
 *      The agent's *kind* (Claude / Codex / OpenCode) is no
 *      longer surfaced here; the dock row is the dense list
 *      view and the kind glyph repeats across rows without
 *      carrying state-relevant signal. Kind identity lives on
 *      the terminal title bar (`AgentIndicator`) and the
 *      workspace switcher cards, where there's room.
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
 *  Each export could be split into its own file the moment one of
 *  these axes diverges enough to justify the boundary; for now
 *  the location grouping is honest because the file is small and
 *  the three pieces are consumed together. The file name is
 *  `RowPips` (a noun for the thing) rather than `RowIcons` (a
 *  noun for the file). */

import type { TerminalId, TerminalMetadata } from "kolu-common/surface";
import { type GitHubPrInfo, prValue } from "kolu-github/schemas";
import { type Component, Match, Show, Switch, createMemo } from "solid-js";
import ChecksIndicator from "../../terminal/ChecksIndicator";
import { prTooltip } from "../../terminal/prTooltip";
import type { TerminalDisplayInfo } from "../../terminal/terminalDisplay";
import { useTerminalStore } from "../../terminal/useTerminalStore";
import { PrStateIcon } from "../../ui/Icons";
import type { DockRowBucket } from "./dockRowRanking";
import { SubCountChip } from "./SubCountChip";

/** Per-row combined reactive data — `info` + `meta` in a single memo.
 *  Three components (`DockRow`, `RailChip`, `MobileRow`) build the same
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

/** State-pip render variant — the dispatch the JSX renders. Pure
 *  function of `(bucket, unread)` so the rule is independently
 *  testable without spinning up a Solid render harness. Order
 *  matters: `unread` dominates the bucket — a row that just fired
 *  an alert in the background still reads as "attention" even if
 *  the agent has since transitioned to working, because the unread
 *  obligation outlives the bucket transition until the user
 *  activates the row. */
export type PipVariant =
  | "attention" // unread: loud filled disk + halo + pulse
  | "awaiting" // bucket awaiting, !unread: quiet dim dot (lingering)
  | "working" // hollow spinning ring
  | "idle" // muted small dot
  | "empty"; // parked / none — render nothing

export function pipVariant(bucket: DockRowBucket, unread: boolean): PipVariant {
  if (unread) return "attention";
  if (bucket === "awaiting") return "awaiting";
  if (bucket === "working") return "working";
  if (bucket === "idle") return "idle";
  if (bucket === "parked" || bucket === "none") return "empty";
  // Exhaustiveness fence — a future DockRowBucket literal must add an
  // explicit arm above. Mirrors the `state satisfies never` pattern in
  // `dockModel.ts` so a new bucket can't silently map to "empty".
  bucket satisfies never;
  return "empty";
}

/** Inline PR pip — leading glyph on row line 2. Caller controls
 *  layout (typically a flex container alongside the subline text).
 *  Renders nothing when there's no PR. */
export const PrPip: Component<{ meta: TerminalMetadata }> = (props) => {
  const pr = (): GitHubPrInfo | null => prValue(props.meta.pr);
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
      <SubCountChip
        count={props.subCount}
        active={false}
        testId="dock-sub-count"
      />
    </Show>
  </span>
);

/** First-column state pip. Always renders a cell so subgrid placement
 *  stays stable; the cell renders nothing inside for `parked`/`none`
 *  rows. Shape carries the state distinction (filled disk vs hollow
 *  ring vs muted dot) so the rule survives reduced color sensitivity
 *  and peripheral glance — not color and animation alone. */
export const StatePip: Component<{
  bucket: DockRowBucket;
  unread: boolean;
}> = (props) => {
  const variant = () => pipVariant(props.bucket, props.unread);
  return (
    <span
      class="flex items-center justify-center"
      data-testid="dock-row-pip"
      data-pip={variant()}
      title={PIP_TITLES[variant()]}
    >
      <Switch fallback={null}>
        <Match when={variant() === "attention"}>
          <span class="w-2 h-2 rounded-full bg-alert animate-pulse ring-4 ring-alert/25" />
        </Match>
        <Match when={variant() === "awaiting"}>
          <span class="w-1.5 h-1.5 rounded-full bg-alert/55" />
        </Match>
        <Match when={variant() === "working"}>
          <span class="w-2.5 h-2.5 rounded-full border-2 border-accent border-t-transparent animate-spin" />
        </Match>
        <Match when={variant() === "idle"}>
          <span class="w-1.5 h-1.5 rounded-full bg-fg-3/55" />
        </Match>
      </Switch>
    </span>
  );
};

const PIP_TITLES: Record<PipVariant, string> = {
  attention: "Needs attention",
  awaiting: "Awaiting input",
  working: "Working",
  idle: "Idle",
  empty: "",
};
