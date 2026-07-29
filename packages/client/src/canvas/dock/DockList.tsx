/** DockList — the recency-sorted live-terminal list shared by the two touch
 *  layouts: the phone's left-edge swipe drawer (inlined in `MobileTileView`)
 *  and the compact layout's persistent left rail (`CompactTileView`).
 *
 *  Rows match the desktop bare-dock layout — `[indicator] branch [pips] time`
 *  over a CSS subgrid — but with uniform `py-3` so every tap target clears the iOS /
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

import { activeArm } from "@kolu/padi/surface";
import { AttentionTriplet, StatePip } from "@kolu/solid-statepip";
import { DOCK_ROW_PIP_BOX } from "@kolu/solid-statepip/pipVariant";
import type { TerminalId } from "kolu-common/surface";
import { For, Show } from "solid-js";
import { IntentMarkdownInline } from "../../intent/IntentMarkdown";
import { annotationLine } from "../../intent/text";
import { useStatePip } from "../../terminal/statePipBind";
import { useTerminalStore } from "../../terminal/useTerminalStore";
import {
  DOCK_CARDS_SUBGRID_LEFT_RESTORE,
  DOCK_ROW_BRANCH_COL,
  DOCK_ROW_GAP,
  DOCK_ROW_GRID,
  SLEEPING_RECEDE_CLASS,
} from "../../ui/chromeSpacing";
import RepoMonogram from "../../ui/RepoMonogram";
import { encActiveHost } from "../../wire";
import { dockRowAttrs } from "./dockRowAttrs";
import { type DockRowBucket, rowRecencyAt } from "./dockRowRanking";
import type { DockGroup } from "./dockTree";
import { HiddenFooter } from "./HiddenFooter";
import RecencyCell, { displayRecencyAt, recencyMode } from "./RecencyCell";
import { createDockRowData } from "./dockRowData";
import { PrPip } from "./PrPip";
import { rowSubline } from "./rowSubline";
import { SubTerminalRow } from "./SubTerminalRow";
import { useDockOrder } from "./useDockOrder";
import { useSectionAttention } from "./useSectionAttention";

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
        <div class="flex flex-col gap-2.5 p-2">
          <For each={tree().groups}>
            {(group) => (
              <DockListSection group={group} onSelect={props.onSelect} />
            )}
          </For>
        </div>
      </div>
      <HiddenFooter
        hiddenCount={tree().hiddenCount}
        sleepingCount={tree().sleepingCount}
        compact
        testId="mobile-dock-hidden-footer"
        chipTestIdPrefix="mobile-dock-window"
      />
    </>
  );
}

/** Repo section — monogram + spine + sticky header over the group's
 *  rows, sharing the desktop dock's `.dock-cards-section*` classes so
 *  both surfaces carry one repo-identity vocabulary. Always rendered,
 *  matching the desktop dock's "section headers always on" policy. */
function DockListSection(props: {
  group: DockGroup;
  onSelect: (id: TerminalId) => void;
}) {
  // Same shared fold as the desktop header — the two headers cannot count
  // differently. Capsules stay plain spans here (no jump handlers): the rows
  // they summarize are directly below on a touch surface.
  const attn = useSectionAttention(() => props.group);
  // Subgrid container — same shape as the desktop dock (the shared
  // `DOCK_ROW_GRID`). Three cols: indicator · branch · time.
  // The leading 20px indicator track is fixed (not `auto`) holding
  // `StatePip`, so the indicator never shifts as its axes flip. PR
  // pip lives on line 2 (left) alongside the subline, anchored to the
  // branch column's left edge so PR icons align across every section.
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
      class={`dock-cards-section grid ${DOCK_ROW_GRID} ${DOCK_ROW_GAP} pl-3 pr-3`}
    >
      <div
        data-testid="mobile-dock-section-header"
        class="dock-cards-section-header col-span-full flex items-center gap-2 -ml-3 -mr-3 pl-2.5 pr-3 py-2.5"
      >
        <RepoMonogram
          group={props.group.name}
          color={props.group.color}
          data-testid="mobile-dock-section-monogram"
        />
        <span
          data-testid="mobile-dock-section-name"
          class="dock-cards-section-name font-mono text-[0.7rem] font-extrabold uppercase tracking-[0.1em] truncate min-w-0"
        >
          {props.group.name}
        </span>
        <span
          class="dock-cards-section-count font-mono text-[0.6rem]"
          title={`${props.group.railEntries.length} terminals`}
        >
          {props.group.railEntries.length}
        </span>
        <AttentionTriplet
          active={attn().activeIds.length}
          asking={attn().askingIds.length}
          unseen={attn().unseenIds.length}
          sizeClass="min-w-4 px-1 h-4"
          scopeLabel={props.group.name}
          class="ml-auto"
        />
      </div>
      <For each={props.group.topRows}>
        {(row) => (
          <>
            <DockListRow
              id={row.id}
              bucket={row.bucket}
              pip={row.pip}
              recencyAt={row.ts}
              onSelect={props.onSelect}
            />
            <For each={row.subRows}>
              {(sub) => (
                <SubTerminalRow
                  row={sub}
                  surface="touch"
                  onSelect={props.onSelect}
                />
              )}
            </For>
          </>
        )}
      </For>
    </section>
  );
}

/** Touch counterpart to `Dock.tsx`'s `DockRow`. Geometry is shared
 *  (two-line subgrid, indicator + branch + time on line 1,
 *  PR pip + subline on line 2); the two diverge on touch target sizing,
 *  the Corvu drag-to-dismiss pointer-down trap, and the absence of a
 *  `Cmd+N` shortcut hint. Update both files when row geometry changes. */
function DockListRow(props: {
  id: TerminalId;
  /** ORDER bucket — drives `data-bucket`. */
  bucket: DockRowBucket;
  /** PIP bucket — drives the `StatePip` colour, identical to the tile title's
   *  pip (both `agentPaintClass`), decoupled from order. */
  pip: DockRowBucket;
  /** Newest activity in the whole tile, including its splits. */
  recencyAt: number | null;
  onSelect: (id: TerminalId) => void;
}) {
  const store = useTerminalStore();
  const combined = createDockRowData(props.id);
  const unread = () => store.isUnread(props.id);
  return (
    <Show when={combined()}>
      {(c) => {
        const pip = useStatePip(
          encActiveHost,
          () => props.id,
          () => c().meta,
          unread,
          () => props.pip,
        );
        const mode = () => recencyMode(pip());
        return (
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
            // The shared row contract (`dockRowAttrs`) — see `Dock.tsx`. The
            // washes key on the ATTENTION class, not the ORDER bucket.
            {...dockRowAttrs({
              id: props.id,
              bucket: props.bucket,
              agentState: activeArm(c().meta)?.agent?.state,
              asking: pip().asking,
              unread: unread(),
            })}
            data-sleeping={pip().sleeping ? "" : undefined}
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
            class={`w-full grid grid-cols-subgrid col-span-full items-center py-3 ${DOCK_CARDS_SUBGRID_LEFT_RESTORE} -mr-3 pr-3 border-l-[length:var(--dock-edge-stripe-w)] border-l-transparent text-left transition-colors duration-150 cursor-pointer active:bg-surface-2`}
            classList={{ [SLEEPING_RECEDE_CLASS]: pip().sleeping }}
          >
            {/* Identity status indicator — same binder as Dock/title. */}
            <span class="row-span-2 flex self-center">
              <StatePip {...pip()} class={DOCK_ROW_PIP_BOX} />
            </span>
            <span
              class="dock-cards-row-label text-[0.9rem]"
              style={{
                color: c().info.annotationColor,
              }}
            >
              <IntentMarkdownInline
                markdown={annotationLine(c().meta.intent, c().info.key.label)}
              />
            </span>
            {/* Recency — hidden while active; width reserved. Blocked rows
             *  show the violet wait chip instead (see RecencyCell). */}
            <RecencyCell
              recencyAt={displayRecencyAt(
                mode(),
                props.recencyAt,
                rowRecencyAt(c().meta),
              )}
              textSize="text-[0.65rem]"
              mode={mode()}
            />
            {/* Second line — flex row spanning the branch column → end.
             *  PR pip on the left (anchored to the branch column's left
             *  edge so it aligns across every section), subline text
             *  following. */}
            <div
              class={`${DOCK_ROW_BRANCH_COL} col-end-[-1] flex items-center gap-1.5 min-w-0 mt-0.5`}
            >
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
                      activeArm(c().meta)?.agent
                        ? "mobile-dock-agent-subline"
                        : "mobile-dock-foreground"
                    }
                    // The shared subline hook — see `Dock.tsx`. Set only on the
                    // AGENT subline.
                    data-dock-subline={
                      activeArm(c().meta)?.agent ? "" : undefined
                    }
                    class="font-mono text-[0.7rem] leading-snug text-fg-3 truncate min-w-0"
                    title={line()}
                  >
                    {line()}
                  </span>
                )}
              </Show>
            </div>
          </div>
        );
      }}
    </Show>
  );
}
