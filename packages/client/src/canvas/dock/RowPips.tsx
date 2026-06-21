/** Presence pips that ride on every dock row.
 *
 *  Four independent change axes share this file because each
 *  produces a small JSX cell consumed identically by both the
 *  desktop dock and the mobile drawer. The file groups them so the
 *  two callers can `import { ActivityPip, StatePip, PrPip, SubCountCell }`
 *  rather than reach into four single-export modules:
 *
 *    - `ActivityPip` (live-output presence) — first grid column,
 *      left of the `StatePip`. Holds the `LiveActivityDot` while the
 *      terminal streams output and an empty width-reserved cell
 *      otherwise (full definition below). "Moving bytes right now",
 *      a distinct axis from the agent's working/awaiting state.
 *    - `StatePip` (row-state-only visualization) — second grid
 *      column, immediately after `ActivityPip`. Always renders a
 *      cell so subgrid placement stays
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
 *  the four pieces are consumed together. The file name is
 *  `RowPips` (a noun for the thing) rather than `RowIcons` (a
 *  noun for the file). */

import {
  activePr,
  type TerminalId,
  type TerminalMetadata,
} from "kolu-common/surface";
import type { PrInfo } from "anyforge/schemas";
import { type Component, createMemo, Match, Show, Switch } from "solid-js";
import ChecksIndicator from "../../terminal/ChecksIndicator";
import LiveActivityDot from "../../terminal/LiveActivityDot";
import { MOONLIT } from "../../terminal/moonlit";
import { prTooltip } from "../../terminal/prTooltip";
import type { TerminalDisplayInfo } from "../../terminal/terminalDisplay";
import { useTerminalActivity } from "../../terminal/useTerminalActivity";
import { useTerminalStore } from "../../terminal/useTerminalStore";
import { PrStateIcon } from "../../ui/Icons";
import type { DockRowBucket } from "./dockRowRanking";
import { type PipVariant, pipVariant } from "./pipVariant";
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

/** Leading activity cell — first grid column, left of the `StatePip`.
 *  Holds the `LiveActivityDot` while the terminal is streaming output and
 *  an empty (width-reserved) cell otherwise, so the StatePip column to its
 *  right stays aligned across rows whether or not a given row is live. The
 *  `isLive` gate is consulted here, once per call site, exactly as the
 *  title bar and rail overlays consult it at theirs. Distinct axis from the
 *  StatePip: this is "moving bytes right now" (a compile, a `tail -f`, any
 *  shell), not the agent's working/awaiting state. */
export const ActivityPip: Component<{ id: TerminalId }> = (props) => {
  const activity = useTerminalActivity();
  return (
    <span class="flex items-center justify-center">
      <Show when={activity.isLive(props.id)}>
        <LiveActivityDot />
      </Show>
    </span>
  );
};

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

/** First-column state pip. Always renders a cell so subgrid placement
 *  stays stable; the cell renders nothing inside for `parked`/`none`
 *  rows. Shape carries the state distinction (filled disk vs hollow
 *  ring vs muted dot) so the rule survives reduced color sensitivity
 *  and peripheral glance — not color and animation alone. */
export const StatePip: Component<{
  bucket: DockRowBucket;
  unread: boolean;
}> = (props) => {
  // createMemo so pipVariant runs once per (bucket, unread) change and the
  // JSX reads a cached value rather than recomputing on each of the 6 read sites.
  const variant = createMemo(() => pipVariant(props.bucket, props.unread));
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
        <Match when={variant() === "sleeping"}>
          {/* Moonlit ☾ — a deliberate dormant state, visually distinct from the
           *  agent shapes and from the parked-drop. */}
          <span
            class="text-[0.7rem] leading-none"
            style={{ color: MOONLIT.accent }}
          >
            ☾
          </span>
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
  sleeping: "Sleeping",
  empty: "",
};
