/** MobileDockDrawer — left-edge swipe drawer carrying the dock
 *  terminal list on mobile.
 *
 *  Mobile mirror of the desktop dock (#903): the dock is the canonical
 *  live-terminal navigator, so on mobile it gets the standard iOS /
 *  Android "navigation drawer" gesture — swipe from the left edge, or
 *  tap the thin left-edge handle, to reveal the terminal list.
 *
 *  Rows match the desktop bare-dock layout — `[agent] branch [pips]
 *  time` over a CSS subgrid — but with uniform `py-3` so every tap
 *  target clears the iOS / Android 44-48 px minimum. No reply input
 *  and no xterm buffer tail; the user's intent here is "switch to
 *  that other terminal", not "respond inline".
 *
 *  Row order mirrors the desktop dock: same `useDockOrder` singleton,
 *  so the mobile drawer and desktop never disagree on group order, row
 *  order, or which rows are hidden by the activity window. */

import type { TerminalId } from "kolu-common/surface";
import { type Component, For, Show, createMemo } from "solid-js";
import { IntentMarkdownInline } from "../../intent/IntentMarkdown";
import { annotationLine } from "../../intent/text";
import { formatTimeAgo } from "../../terminal/staleness";
import { useTerminalStore } from "../../terminal/useTerminalStore";
import {
  activityWindow,
  setActivityWindow,
  windowOption,
} from "../../terminal/activityWindow";
import type { DockRowBucket } from "./dockRowRanking";
import type { DockGroup } from "./dockTree";
import { useDockOrder } from "./useDockOrder";
import { AgentSlot, PrPip, SubCountCell } from "./RowIcons";
import { rowSubline } from "./rowSubline";

const MobileDockDrawer: Component<{
  onSelect: (id: TerminalId) => void;
  onClose: () => void;
}> = (props) => {
  const tree = useDockOrder();

  function handleSelect(id: TerminalId) {
    props.onSelect(id);
    props.onClose();
  }

  return (
    <div data-testid="mobile-dock-sheet" class="flex flex-col h-full">
      <div class="px-3 py-2 border-b border-edge/50 shrink-0">
        <span class="font-mono text-[0.65rem] uppercase tracking-[0.18em] text-fg-3">
          Terminals
        </span>
      </div>
      <div class="flex-1 min-h-0 overflow-y-auto">
        <For each={tree().groups}>
          {(group) => <MobileSection group={group} onSelect={handleSelect} />}
        </For>
      </div>
      <Show when={tree().parkedCount > 0 && activityWindow() !== "all"}>
        <button
          type="button"
          data-testid="mobile-dock-hidden-footer"
          onClick={() => setActivityWindow("all")}
          class="flex items-center gap-2 px-3 py-3 border-t border-edge/40 text-[0.75rem] text-fg-3 active:bg-surface-2 text-left cursor-pointer"
        >
          <span class="tabular-nums">{tree().parkedCount}</span>
          <span>
            hidden by{" "}
            <span class="font-mono">
              {windowOption(activityWindow()).short}
            </span>{" "}
            window
          </span>
          <span class="ml-auto text-accent shrink-0">show all</span>
        </button>
      </Show>
    </div>
  );
};

/** Repo section — header (uppercase name + colored swatch + row count)
 *  over the group's rows. Always rendered, matching the desktop dock's
 *  "section headers always on" policy. */
const MobileSection: Component<{
  group: DockGroup;
  onSelect: (id: TerminalId) => void;
}> = (props) => (
  // Subgrid container — same shape as the desktop dock. Four cols:
  // agent · branch · sub-count · time. PR pip lives on line 2 (left)
  // alongside the subline, anchored to col 2 left edge so PR icons
  // align across every section.
  <section
    data-testid="mobile-dock-section"
    data-repo={props.group.name}
    class="grid grid-cols-[20px_minmax(0,1fr)_auto_auto] gap-x-3 pl-6 pr-3"
  >
    <div class="col-span-full flex items-center gap-2 -ml-6 -mr-3 pl-3 pr-3 py-2 bg-surface-2/60 border-y border-edge/30">
      <span
        data-testid="mobile-dock-section-name"
        class="font-mono text-[0.65rem] font-bold uppercase tracking-[0.14em] truncate min-w-0"
        style={{ color: props.group.color }}
      >
        {props.group.name}
      </span>
      <span class="ml-auto font-mono text-[0.65rem] tabular-nums text-fg-3 shrink-0">
        {props.group.rows.length}
      </span>
    </div>
    <For each={props.group.rows}>
      {(row) => (
        <MobileRow id={row.id} bucket={row.bucket} onSelect={props.onSelect} />
      )}
    </For>
  </section>
);

const MobileRow: Component<{
  id: TerminalId;
  bucket: DockRowBucket;
  onSelect: (id: TerminalId) => void;
}> = (props) => {
  const store = useTerminalStore();
  const combined = createMemo(() => {
    const info = store.getDisplayInfo(props.id);
    const meta = store.getMetadata(props.id);
    if (!info || !meta) return null;
    return { info, meta };
  });
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
          // drag-to-dismiss from claiming the tap.
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => props.onSelect(props.id)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              props.onSelect(props.id);
            }
          }}
          class="relative w-full grid grid-cols-subgrid col-span-full items-center py-3 -ml-6 -mr-3 border-l-[3px] border-l-transparent border-b border-b-edge/15 text-left transition-colors duration-150 cursor-pointer active:bg-surface-2 data-[active]:bg-accent/15 data-[active]:border-l-accent"
        >
          <AgentSlot agent={c().meta.agent} />
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
          <Show when={unread()}>
            <span
              aria-hidden="true"
              class="absolute top-1.5 right-2 w-1.5 h-1.5 rounded-full bg-alert animate-pulse"
            />
          </Show>
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
};

export default MobileDockDrawer;
