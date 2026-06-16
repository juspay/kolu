/** DockList — the recency-sorted live-terminal list shared by the two touch
 *  layouts: the phone's left-edge swipe drawer (inlined in `MobileTileView`)
 *  and the compact layout's persistent left rail (`CompactTileView`).
 *
 *  Rows match the desktop bare-dock layout — `[agent] branch [pips] time` over a
 *  CSS subgrid — but with uniform `py-3` so every tap target clears the iOS /
 *  Android 44-48 px minimum. No reply input and no xterm buffer tail; the user's
 *  intent here is "switch to that other terminal", not "respond inline".
 *
 *  Row order mirrors the desktop dock: same `useDockOrder` singleton, so every
 *  surface (desktop dock, phone drawer, compact rail) agrees on group order, row
 *  order, and which rows the activity window hides.
 *
 *  Renders as a fragment (header · scroll list · hidden footer); the host
 *  supplies a `flex flex-col h-full` container and decides selection semantics —
 *  the drawer dismisses on select, the rail does not. */

import type { TerminalId } from "kolu-common/surface";
import { For, Show } from "solid-js";
import { IntentMarkdownInline } from "../../intent/IntentMarkdown";
import { annotationLine } from "../../intent/text";
import { formatTimeAgo } from "../../terminal/staleness";
import { useTerminalStore } from "../../terminal/useTerminalStore";
import { DOCK_CARDS_SUBGRID_LEFT_RESTORE } from "../../ui/chromeSpacing";
import type { DockRowBucket } from "./dockRowRanking";
import type { DockGroup } from "./dockTree";
import { HiddenFooter } from "./HiddenFooter";
import { createDockRowData, PrPip, StatePip, SubCountCell } from "./RowPips";
import { rowSubline } from "./rowSubline";
import { useDockOrder } from "./useDockOrder";

export function DockList(props: { onSelect: (id: TerminalId) => void }) {
  const tree = useDockOrder();
  return (
    <>
      <div class="px-3 py-2 border-b border-edge/50 shrink-0">
        <span class="font-mono text-[0.65rem] uppercase tracking-[0.18em] text-fg-3">
          Terminals
        </span>
      </div>
      <div class="flex-1 min-h-0 overflow-y-auto">
        <For each={tree().groups}>
          {(group) => (
            <DockListSection group={group} onSelect={props.onSelect} />
          )}
        </For>
      </div>
      <HiddenFooter
        parkedCount={tree().parkedCount}
        compact
        testId="mobile-dock-hidden-footer"
        chipTestIdPrefix="mobile-dock-window"
      />
    </>
  );
}

/** Repo section — a repo-colored left-edge spine plus a faintly
 *  repo-tinted sticky header (uppercase name + row count) over the
 *  group's rows, sharing the desktop dock's `.dock-cards-section*`
 *  classes so both surfaces carry one repo-identity vocabulary.
 *  Always rendered, matching the desktop dock's "section headers
 *  always on" policy. */
function DockListSection(props: {
  group: DockGroup;
  onSelect: (id: TerminalId) => void;
}) {
  // Subgrid container — same shape as the desktop dock. Four cols:
  // agent · branch · sub-count · time. PR pip lives on line 2 (left)
  // alongside the subline, anchored to col 2 left edge so PR icons
  // align across every section.
  //
  // Right gutter (`pr-3` / `-mr-3`) happens to match the desktop
  // `DOCK_CARDS_GUTTER_*` value today, but the two are kept separate
  // because they encode different volatility — this tight gutter is a
  // touch-density choice, desktop's is the chrome-density vocabulary.
  // Promote to a shared constant the moment a third file consumes it.
  return (
    <section
      data-testid="mobile-dock-section"
      data-repo={props.group.name}
      style={{ "--repo-color": props.group.color }}
      class="dock-cards-section grid grid-cols-[20px_minmax(0,1fr)_auto_auto] gap-x-3 pl-6 pr-3"
    >
      <div
        data-testid="mobile-dock-section-header"
        class="dock-cards-section-header col-span-full flex items-center gap-2 -ml-6 -mr-3 pl-3 pr-3 py-2 border-y border-edge/30"
      >
        <span
          data-testid="mobile-dock-section-name"
          class="font-mono text-[0.65rem] font-bold uppercase tracking-[0.14em] truncate min-w-0"
          style={{ color: "var(--repo-color)" }}
        >
          {props.group.name}
        </span>
        <span class="ml-auto font-mono text-[0.65rem] tabular-nums text-fg-3 shrink-0">
          {props.group.rows.length}
        </span>
      </div>
      <For each={props.group.rows}>
        {(row) => (
          <DockListRow
            id={row.id}
            bucket={row.bucket}
            onSelect={props.onSelect}
          />
        )}
      </For>
    </section>
  );
}

/** Touch counterpart to `Dock.tsx`'s `DockRow`. Geometry is shared
 *  (two-line subgrid, agent slot + branch + sub-count + time on
 *  line 1, PR pip + subline on line 2); the two diverge on touch
 *  target sizing, the Corvu drag-to-dismiss pointer-down trap, and
 *  the absence of a `Cmd+N` shortcut hint. Update both files when
 *  row geometry changes. */
function DockListRow(props: {
  id: TerminalId;
  bucket: DockRowBucket;
  onSelect: (id: TerminalId) => void;
}) {
  const store = useTerminalStore();
  const combined = createDockRowData(props.id);
  const active = () => store.activeId() === props.id;
  const unread = () => store.isUnread(props.id);
  return (
    <Show when={combined()}>
      {(c) => (
        // Row is `<div role="button">` rather than `<button>` so the
        // `<a>` PR pip on line 2 stays valid HTML (no `<a>` inside
        // `<button>` nesting). Activation keyboard handlers mirror
        // native button behaviour (Enter + Space). Same trade-off
        // the desktop dock makes; see `Dock.tsx` for the longer
        // rationale.
        // biome-ignore lint/a11y/useSemanticElements: native button would nest invalid interactive HTML — see Dock.tsx
        <div
          role="button"
          tabIndex={0}
          data-testid="mobile-dock-row"
          data-terminal-id={props.id}
          data-bucket={props.bucket}
          data-active={active() ? "" : undefined}
          data-unread={unread() ? "" : undefined}
          data-sub-count={c().info.subCount > 0 ? c().info.subCount : undefined}
          // stopPropagation on pointerdown keeps Corvu Drawer's
          // drag-to-dismiss from claiming the tap (no-op in the rail,
          // load-bearing in the phone drawer).
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => props.onSelect(props.id)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              props.onSelect(props.id);
            }
          }}
          // Right side stays at the call site because the touch list uses
          // `-mr-3 pr-3` (12 px) — the tighter touch-gutter — while
          // desktop rides on `DOCK_CARDS_GUTTER_*` (24 px). The left
          // side is symmetric between the two surfaces, so it ships
          // as one symbol.
          class={`w-full grid grid-cols-subgrid col-span-full items-center py-3 ${DOCK_CARDS_SUBGRID_LEFT_RESTORE} -mr-3 pr-3 border-l-[length:var(--dock-edge-stripe-w)] border-l-transparent border-b border-b-edge/15 text-left transition-colors duration-150 cursor-pointer active:bg-surface-2 data-[active]:bg-accent/15 data-[active]:border-l-accent`}
        >
          <StatePip bucket={props.bucket} unread={unread()} />
          <span
            class="font-medium text-[0.9rem] leading-tight truncate min-w-0"
            style={{
              color: c().info.annotationColor,
            }}
          >
            <IntentMarkdownInline
              markdown={annotationLine(c().meta.intent, c().info.key.label)}
            />
          </span>
          <SubCountCell subCount={c().info.subCount} />
          <span class="font-mono text-[0.65rem] tabular-nums text-fg-3 text-right">
            {formatTimeAgo(c().meta.lastActivityAt)}
          </span>
          {/* Second line — flex row spanning col 2 → end. PR pip on
           *  the left (anchored to col 2 left edge so it aligns
           *  across every section), subline text following. */}
          <div class="col-start-2 col-end-[-1] flex items-center gap-1.5 min-w-0">
            <PrPip meta={c().meta} />
            <Show
              when={rowSubline(c().meta)}
              fallback={
                <span
                  aria-hidden="true"
                  class="font-mono text-[0.7rem] leading-tight invisible"
                >
                  &nbsp;
                </span>
              }
            >
              {(line) => (
                <span
                  data-testid={
                    c().meta.agent
                      ? "mobile-dock-agent-subline"
                      : "mobile-dock-foreground"
                  }
                  class="font-mono text-[0.7rem] leading-tight text-fg-2 truncate min-w-0"
                  title={line()}
                >
                  {line()}
                </span>
              )}
            </Show>
          </div>
        </div>
      )}
    </Show>
  );
}
