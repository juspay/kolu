/** DockList — the live-terminal list shared by the two touch layouts: the
 *  phone's left-edge swipe drawer (inlined in `MobileTileView`) and the compact
 *  layout's persistent left rail (`CompactTileView`).
 *
 *  Rows match the desktop bare-dock layout — `[indicator] branch [pips] time`
 *  over a CSS subgrid — but with uniform `py-3` so every tap target clears the iOS /
 *  Android 44-48 px minimum. No reply input and no xterm buffer tail; the user's
 *  intent here is "switch to that other terminal", not "respond inline".
 *
 *  Row order mirrors the desktop dock: same `useDockOrder` singleton, so every
 *  surface (desktop dock, phone drawer, compact rail) agrees on group order, row
 *  order, and which rows the activity window hides — creation order throughout,
 *  never a clock. The pinned needs-you strip rides that same singleton, so a
 *  blocked agent is as findable on a phone as it is on the desktop.
 *
 *  Renders as a fragment (header · scroll list · hidden footer); the host
 *  supplies a `flex flex-col h-full` container and decides selection semantics —
 *  the drawer dismisses on select, the rail does not. */

import { activeArm, activePr } from "@kolu/padi-client/surface";
import { DockRow as DockRowView, DockSection } from "@kolu/solid-dockrow";
import { type DockRowBucket, rowSubline } from "@kolu/solid-dockrow/rowValues";
import { AttentionTriplet } from "@kolu/solid-statepip";
import type { TerminalId } from "kolu-common/surface";
import { For, Show } from "solid-js";
import { annotationLine } from "../../intent/text";
import { useStatePip } from "../../terminal/statePipBind";
import { useTerminalStore } from "../../terminal/useTerminalStore";
import RepoMonogram from "../../ui/RepoMonogram";
import { encActiveHost } from "../../wire";
import { isActiveRow } from "./activeRow";
import { renderRowLabel } from "./renderRowLabel";
import { createDockRowData } from "./dockRowData";
import { rowRecencyAt } from "./dockRowRanking";
import type { DockGroup } from "./dockTree";
import { HiddenFooter } from "./HiddenFooter";
import { NeedsYouStrip } from "./NeedsYouStrip";
import { useRowRecency } from "./rowRecency";
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
      <NeedsYouStrip
        entries={tree().needsYou}
        density="full"
        onSelect={props.onSelect}
      />
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
    <DockSection
      density="touch"
      testId="mobile-dock-section"
      repo={props.group.name}
      repoColor={props.group.color}
      header={
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
      }
    >
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
    </DockSection>
  );
}

/** kolu's TOUCH wiring for `@kolu/solid-dockrow`'s two-line row — the same
 *  component `Dock.tsx` renders, at `touch` density.
 *
 *  The two used to be hand-kept copies of one row's markup, linked by a comment
 *  reading "Update both files when row geometry changes". The divergences that
 *  comment defended — tap-target sizing, the Corvu drag-to-dismiss pointer trap,
 *  and the absence of a `Cmd+N` shortcut hint — are the density token and two
 *  props below, not a second component. */
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
  const rowRecency = useRowRecency();
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
        return (
          <DockRowView
            id={props.id}
            density="touch"
            pip={pip()}
            bucket={props.bucket}
            agentState={activeArm(c().meta)?.agent?.state}
            active={isActiveRow(props.id)}
            label={annotationLine(c().meta.intent, c().info.key.label)}
            labelColor={c().info.annotationColor}
            renderLabel={renderRowLabel}
            subline={rowSubline(c().meta)}
            pr={activePr(c().meta)}
            recency={rowRecency(pip(), props.recencyAt, rowRecencyAt(c().meta))}
            onSelect={() => props.onSelect(props.id)}
            // stopPropagation on pointerdown keeps Corvu Drawer's
            // drag-to-dismiss from claiming the tap (no-op in the rail,
            // load-bearing in the phone drawer).
            onPointerDown={(event) => event.stopPropagation()}
            testIds={{
              row: "mobile-dock-row",
              agentSubline: "mobile-dock-agent-subline",
              quietSubline: "mobile-dock-foreground",
            }}
          />
        );
      }}
    </Show>
  );
}
