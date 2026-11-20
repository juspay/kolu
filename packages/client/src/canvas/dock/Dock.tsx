import type { DockRailEntry } from "./dockTree";
import { Key } from "@solid-primitives/keyed";
import { activeArm } from "@kolu/padi-client/surface";

import {
  DockCluster,
  type DockDragHandlers,
  DockRow as DockRowView,
  DockSection,
} from "@kolu/solid-dockrow";
import type { DockRowBucket } from "@kolu/solid-dockrow/rowValues";
import {
  closestCenter,
  createDroppable,
  createSortable,
  DragDropProvider,
  DragDropSensors,
  DragOverlay,
  type DragEvent,
  SortableProvider,
  maybeTransformStyle,
} from "@thisbeyond/solid-dnd";
import { AttentionTriplet } from "@kolu/solid-statepip";
import { createElementSize } from "@solid-primitives/resize-observer";
import type { TerminalId } from "kolu-common/surface";
import {
  type Component,
  createEffect,
  createMemo,
  createSignal,
  type JSX,
  onCleanup,
  onMount,
  Show,
} from "solid-js";
import { createSharedRoot } from "../../createSharedRoot";
import { ACTIONS } from "../../input/actions";
import { isPlatformModifier } from "../../input/keyboard";
import { intentLeadGlyph } from "../../intent/text";
import { persistedPref } from "../../persistedPref";
import LiveActivityDot from "../../terminal/LiveActivityDot";
import type { TerminalDisplayInfo } from "../../terminal/terminalDisplay";
import { setDockOrder } from "../../terminal/dockOrderPref";
import { useTerminalStore } from "../../terminal/useTerminalStore";
import { useStatePip } from "../../terminal/statePipBind";
import { useTileStore } from "../../tile/useTileStore";
import { ChevronDownIcon, PlusIcon, SearchIcon } from "../../ui/Icons";
import { nextAfter } from "../../ui/nextAfter";
import RepoMonogram from "../../ui/RepoMonogram";
import { encActiveHost } from "../../wire";
import { useViewPosture } from "../useViewPosture";
import { capturePointerGesture } from "../viewport/capturePointerGesture";
import { chipInitials } from "./chipInitials";
import { DockShortcutHint } from "./DockShortcutHint";
import {
  CARDS_WIDTH_PX,
  clampDockCardsWidth,
  type DockMode,
  dockCardsWidth,
  renderedDockWidth,
  setDockCardsWidth,
} from "./dockCardsWidth";
import { useDockRowBag } from "./useDockRowBag";
import { isActiveRow } from "./activeRow";
import { createDockRowData, dockRowLabel } from "./dockRowData";
import type { DockBranchCluster, DockGroup, DockTree } from "./dockTree";
import { arrayMove, moveCluster, moveRepo } from "./dockTree";
import {
  HEADER_DROP_ID,
  dockCollisionDetector,
  dropHighlightOf,
  dropTargetOfDroppableId,
  reparentDropOf,
  rowIdOfDragId,
} from "./dockReparent";
import { HiddenFooter } from "./HiddenFooter";
import type { RankedDockRow } from "./dockRowRanking";
import { NeedsYouStrip } from "./NeedsYouStrip";
import { SubTerminalRow } from "./SubTerminalRow";
import { CONTEXTUAL_TIPS } from "../../settings/tips";
import { useTips } from "../../settings/useTips";
import { useDockFocus } from "./useDockFocus";
import { useDockOrder } from "./useDockOrder";
import { useDockReparent } from "./useDockReparent";
import {
  dockDropContext,
  useDockDropVerdict,
  useDockRowDrag,
  useDraggedRowId,
} from "./useDockRowDrag";
import { useSectionAttention } from "./useSectionAttention";

const useModHeld = createSharedRoot(() => {
  const [modHeld, setModHeld] = createSignal(false);
  if (typeof window !== "undefined") {
    const refresh = (e: KeyboardEvent) => setModHeld(isPlatformModifier(e));
    const clear = () => setModHeld(false);
    window.addEventListener("keydown", refresh);
    window.addEventListener("keyup", refresh);
    window.addEventListener("blur", clear);
    document.addEventListener("visibilitychange", clear);
  }
  return modHeld;
});

export const [dockMode, setDockMode] = persistedPref<DockMode>({
  name: "kolu-dock-mode",
  fallback: "cards",
  parse: (raw) => {
    if (raw === "rail" || raw === "cards") return raw;
    throw new Error(`unrecognized dock mode: ${raw}`);
  },
});

export function toggleRailCards(): void {
  setDockMode(dockMode() === "rail" ? "cards" : "rail");
}

export const dockExpanded = (): boolean => dockMode() !== "rail";

const DOCK_RESIZE_STEP_PX = 16;

const Dock: Component<{
  onOpenWorkspaceSearch: () => void;
  onCreate: () => void;
}> = (props) => {
  const tree = useDockOrder();
  const posture = useViewPosture();

  let asideEl!: HTMLElement;
  const [hostEl, setHostEl] = createSignal<HTMLElement | null>(null);
  onMount(() => setHostEl(asideEl.parentElement));
  const hostSize = createElementSize(hostEl);

  const [dragWidth, setDragWidth] = createSignal<number | null>(null);

  const width = createMemo(() =>
    renderedDockWidth({
      mode: dockMode(),
      layout: posture.layout(),
      preferredPx: dragWidth() ?? dockCardsWidth(),
      hostWidthPx: hostSize.width ?? 0,
    }),
  );

  let abortDockResize: AbortController | null = null;
  function startDockResize(e: PointerEvent) {
    if (e.button !== 0) return;
    if (abortDockResize) return;
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = width().px;
    abortDockResize = new AbortController();
    capturePointerGesture(
      {
        onMove: (ev) =>
          setDragWidth(clampDockCardsWidth(startWidth + (ev.clientX - startX))),
        onEnd: () => {
          const width = dragWidth();
          if (width !== null) setDockCardsWidth(width);
          setDragWidth(null);
          abortDockResize = null;
        },
        onCancel: () => {
          setDragWidth(null);
          abortDockResize = null;
        },
      },
      abortDockResize,
      e.pointerId,
    );
  }
  onCleanup(() => abortDockResize?.abort());

  function resizeByKey(e: KeyboardEvent) {
    if (e.key === "Home") setDockCardsWidth(CARDS_WIDTH_PX);
    else if (e.key === "ArrowLeft")
      setDockCardsWidth(width().px - DOCK_RESIZE_STEP_PX);
    else if (e.key === "ArrowRight")
      setDockCardsWidth(width().px + DOCK_RESIZE_STEP_PX);
    else return;
    e.preventDefault();
  }

  return (
    <aside
      data-testid="dock"
      ref={asideEl}
      data-mode={dockMode()}
      data-maximized={posture.layout() === "maximized" ? "" : undefined}
      class="flex flex-col select-none overflow-hidden bg-surface-1"
      classList={{
        "absolute z-30 top-6 left-4 rounded-2xl shadow-2xl shadow-black/40":
          posture.layout() === "tiled",
        "max-h-[calc(100vh-14rem)]": posture.layout() === "tiled",
        "relative shrink-0 h-full border-r border-edge":
          posture.layout() === "maximized",
      }}
      style={{ width: `${width().px}px` }}
    >
      <RailOrCards
        mode={dockMode()}
        tree={tree()}
        onCreate={props.onCreate}
        onOpenWorkspaceSearch={props.onOpenWorkspaceSearch}
      />
      <Show when={width().resizable}>
        <button
          type="button"
          data-testid="dock-resize-handle"
          class="absolute inset-y-0 right-0 z-40 w-1.5 cursor-col-resize hover:bg-accent/30 focus-visible:bg-accent/40 focus-visible:outline-none transition-colors"
          aria-label="Dock width"
          title="Drag or ←/→ to resize · double-click or Home to reset"
          onPointerDown={startDockResize}
          onDblClick={() => setDockCardsWidth(CARDS_WIDTH_PX)}
          onKeyDown={resizeByKey}
        />
      </Show>
    </aside>
  );
};

const RailOrCards: Component<{
  mode: DockMode;
  tree: DockTree;
  onCreate: () => void;
  onOpenWorkspaceSearch: () => void;
}> = (props) => {
  const dockFocus = useDockFocus();
  const store = useTerminalStore();
  const { showTipOnce } = useTips();

  createEffect(() => {
    const t = props.tree;
    const rearrangeable =
      t.groups.length > 1 || t.groups.some((g) => g.clusters.length > 1);
    if (rearrangeable) showTipOnce(CONTEXTUAL_TIPS.dockRearrange);
  });
  createEffect(() => {
    if (
      props.tree.groups.some(
        (g) =>
          g.topRows.filter(
            (r) => activeArm(store.getMetadata(r.id)) !== undefined,
          ).length >= 2,
      )
    )
      showTipOnce(CONTEXTUAL_TIPS.dockRehome);
  });
  const flatIndexOf = createMemo(
    () => new Map(props.tree.flatShortcutRows.map((r, i) => [r.id, i])),
  );
  const dropSection = ({ draggable, droppable }: DragEvent) => {
    if (!droppable || draggable.id === droppable.id) return;
    setDockOrder(
      moveRepo(props.tree.order, String(draggable.id), String(droppable.id)),
    );
  };
  return (
    <div class="flex flex-col w-full min-h-0">
      <DockHeader
        mode={props.mode}
        onCreate={props.onCreate}
        onOpenWorkspaceSearch={props.onOpenWorkspaceSearch}
      />
      <NeedsYouStrip
        entries={props.tree.needsYou}
        density={props.mode === "rail" ? "icon" : "full"}
        onSelect={dockFocus}
      />
      <div class="flex flex-col overflow-y-auto overflow-x-hidden scrollbar-none flex-1 min-h-0">
        <div
          classList={{ hidden: props.mode === "rail" }}
          inert={props.mode === "rail"}
        >
          <DragDropProvider
            collisionDetector={closestCenter}
            onDragEnd={dropSection}
          >
            <DragDropSensors />
            <SortableProvider ids={props.tree.groups.map((g) => g.name)}>
              <div class="flex flex-col gap-2.5 p-2">
                <Key each={props.tree.groups} by={"name"}>
                  {(group) => (
                    <SortableSection
                      group={group()}
                      flatIndexOf={flatIndexOf()}
                      onClusterDrop={(labels) =>
                        setDockOrder(
                          moveCluster(props.tree.order, group().name, labels),
                        )
                      }
                    />
                  )}
                </Key>
              </div>
            </SortableProvider>
          </DragDropProvider>
        </div>
        <div
          classList={{ hidden: props.mode !== "rail" }}
          inert={props.mode !== "rail"}
        >
          <Key each={props.tree.groups} by={"name"}>
            {(group) => (
              <>
                <RailSectionMark color={group().color} name={group().name} />
                <Key each={group().railEntries} by={(entry) => entry.row.id}>
                  {(entry) => (
                    <Show
                      when={entry().kind === "top"}
                      fallback={
                        <RailSubChip
                          row={
                            (
                              entry() as Extract<
                                DockRailEntry,
                                { kind: "split" }
                              >
                            ).row
                          }
                          repoColor={group().color}
                        />
                      }
                    >
                      <RailChip
                        id={entry().row.id}
                        pip={entry().row.pip}
                        flatIndex={flatIndexOf().get(entry().row.id) ?? -1}
                      />
                    </Show>
                  )}
                </Key>
              </>
            )}
          </Key>
        </div>
      </div>
      <Show when={props.tree.hasContent}>
        <HiddenFooter
          hiddenCount={props.tree.hiddenCount}
          sleepingCount={props.tree.sleepingCount}
          surface={props.mode === "rail" ? "rail" : "cards"}
        />
      </Show>
    </div>
  );
};

const DockHeader: Component<{
  mode: DockMode;
  onCreate: () => void;
  onOpenWorkspaceSearch: () => void;
}> = (props) => {
  const railLayout = () => props.mode === "rail";
  return (
    <div
      class="flex items-center gap-1 py-1 border-b border-edge/40 shrink-0"
      classList={{
        "px-1 flex-col": railLayout(),
        "pl-1 pr-3": !railLayout(),
      }}
    >
      <button
        type="button"
        data-testid="dock-new"
        onClick={props.onCreate}
        class="group/new flex items-center justify-center w-6 h-6 rounded-md cursor-pointer text-fg-3 hover:text-fg hover:bg-surface-2/70 active:bg-surface-2 transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
        aria-label={ACTIONS.createTerminal.label}
        title={ACTIONS.createTerminal.label}
      >
        <PlusIcon class="w-3.5 h-3.5 transition-transform duration-200 group-hover/new:rotate-90" />
      </button>
      <button
        type="button"
        data-testid="dock-search"
        onClick={props.onOpenWorkspaceSearch}
        class="flex items-center justify-center w-6 h-6 rounded-md cursor-pointer text-fg-3 hover:text-fg hover:bg-surface-2/70 active:bg-surface-2 transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
        aria-label="Search terminals on this host"
        title="Search terminals on this host"
      >
        <SearchIcon class="w-3.5 h-3.5" />
      </button>
      <button
        type="button"
        data-testid="dock-mode-toggle"
        onClick={toggleRailCards}
        class="flex items-center justify-center w-6 h-6 rounded-md cursor-pointer text-fg-3 hover:text-fg hover:bg-surface-2/70 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
        classList={{ "ml-auto": !railLayout() }}
        aria-label={railLayout() ? "Expand to cards" : "Collapse to rail"}
        title={railLayout() ? "Expand to cards" : "Collapse to rail"}
      >
        <span
          class="inline-flex"
          classList={{
            "rotate-90": !railLayout(),
            "-rotate-90": railLayout(),
          }}
        >
          <ChevronDownIcon class="w-3.5 h-3.5" />
        </span>
      </button>
    </div>
  );
};

const SortableSection: Component<{
  group: DockGroup;
  flatIndexOf: ReadonlyMap<TerminalId, number>;
  onClusterDrop: (labels: readonly string[]) => void;
}> = (props) => {
  const sortable = createSortable(props.group.name);
  return (
    <RepoSection
      group={props.group}
      flatIndexOf={props.flatIndexOf}
      sectionRef={sortable.ref}
      sectionStyle={maybeTransformStyle(sortable.transform)}
      grip={sortable.dragActivators}
      onClusterDrop={props.onClusterDrop}
    />
  );
};

const HeaderDropTarget: Component = () => {
  const store = useTerminalStore();
  const droppable = createDroppable(HEADER_DROP_ID);
  const draggedRowId = useDraggedRowId();
  const verdict = useDockDropVerdict(
    { kind: "header" },
    () => droppable.isActiveDroppable,
  );
  const drop = (): "over" | "invalid" | "target" | undefined => {
    const dragged = draggedRowId();
    if (dragged === null) return undefined;
    const hovered = verdict();
    if (hovered !== undefined) return hovered;
    return dropHighlightOf(dockDropContext(store), dragged, {
      kind: "header",
    }) === "over"
      ? "target"
      : undefined;
  };
  return (
    <span
      ref={droppable.ref}
      data-testid="dock-header-drop"
      data-drop={drop()}
      class="pointer-events-none absolute inset-0 rounded-t-[var(--dock-card-radius-inner)] border-2 border-dashed transition-colors"
      classList={{
        "border-transparent": drop() === undefined,
        "border-accent/40 bg-accent/5": drop() === "target",
        "border-accent bg-accent/15": drop() === "over",
        "border-edge bg-surface-2/50": drop() === "invalid",
      }}
    />
  );
};

const RowDragGhost: Component<{ id: TerminalId }> = (props) => {
  const store = useTerminalStore();
  const label = () => {
    const meta = store.getMetadata(props.id);
    return meta === undefined
      ? ""
      : dockRowLabel(meta, store.getDisplayInfo(props.id));
  };
  return (
    <div class="pointer-events-none absolute inset-0 flex items-center gap-2 rounded-md border border-dashed border-accent/70 bg-accent/5 px-3">
      <span class="min-w-0 truncate font-mono text-[0.72rem] font-semibold text-fg-2">
        {label()}
      </span>
    </div>
  );
};

const RepoSection: Component<{
  group: DockGroup;
  flatIndexOf: ReadonlyMap<TerminalId, number>;
  sectionRef: HTMLElement | ((el: HTMLElement) => void);
  sectionStyle: JSX.CSSProperties;
  grip: DockDragHandlers;
  onClusterDrop: (labels: readonly string[]) => void;
}> = (props) => {
  const store = useTerminalStore();
  const focus = useDockFocus();
  const rehome = useDockReparent();
  const attn = useSectionAttention(() => props.group);
  const jumpTo = (ids: readonly TerminalId[]) => {
    const next = nextAfter(ids, store.focusedTerminalId());
    if (next === undefined) return;
    focus(next);
  };
  const reorderClusters = ({ draggable, droppable }: DragEvent) => {
    if (!droppable || draggable.id === droppable.id) return;
    const visible = props.group.clusters.map((k) => k.label);
    const from = visible.indexOf(String(draggable.id));
    const to = visible.indexOf(String(droppable.id));
    if (from === -1 || to === -1) return;
    props.onClusterDrop(arrayMove(visible, from, to));
  };

  const onDragEnd = ({ draggable, droppable }: DragEvent) => {
    const draggedId = rowIdOfDragId(draggable.id);
    if (draggedId === null) {
      reorderClusters({ draggable, droppable });
      return;
    }
    if (!droppable) return;
    const target = dropTargetOfDroppableId(droppable.id);
    if (target === null) return;
    const drop = reparentDropOf(dockDropContext(store), draggedId, target);
    if (drop === null) return;
    rehome(drop.id, drop.parentId);
  };
  return (
    <DragDropProvider
      collisionDetector={dockCollisionDetector}
      onDragEnd={onDragEnd}
    >
      <DragDropSensors />
      <DragOverlay class="z-40">
        {(draggable) => {
          const id = draggable ? rowIdOfDragId(draggable.id) : null;
          return id === null ? null : <RowDragGhost id={id} />;
        }}
      </DragOverlay>
      <SortableProvider ids={props.group.clusters.map((c) => c.label)}>
        <DockSection
          surface="desktop"
          testId="dock-section"
          repo={props.group.name}
          repoColor={props.group.color}
          headerTestId="dock-section-header"
          ref={props.sectionRef}
          styleProp={props.sectionStyle}
          header={
            <>
              <HeaderDropTarget />
              <span
                class="flex items-center gap-1.5 min-w-0 shrink cursor-grab"
                {...props.grip}
              >
                <RepoMonogram
                  group={props.group.name}
                  color={props.group.color}
                  data-testid="dock-section-monogram"
                />
                <span
                  data-testid="dock-section-name"
                  class="dock-cards-section-name font-mono text-[0.7rem] font-extrabold uppercase tracking-[0.1em] truncate min-w-0"
                  title={props.group.name}
                >
                  {props.group.name}
                </span>
                <span
                  class="dock-cards-section-count font-mono text-[0.6rem]"
                  title={`${props.group.railEntries.length} terminals`}
                >
                  {props.group.railEntries.length}
                </span>
              </span>
              <AttentionTriplet
                active={attn().activeIds.length}
                asking={attn().askingIds.length}
                unseen={attn().unseenIds.length}
                sizeClass="min-w-4 px-1 h-4"
                scopeLabel={props.group.name}
                onAsking={() => jumpTo(attn().askingIds)}
                onUnseen={() => jumpTo(attn().unseenIds)}
                class="ml-auto"
              />
            </>
          }
        >
          <Key each={props.group.clusters} by={"label"}>
            {(cluster) => (
              <SortableCluster
                cluster={cluster()}
                flatIndexOf={props.flatIndexOf}
              />
            )}
          </Key>
        </DockSection>
      </SortableProvider>
    </DragDropProvider>
  );
};

const SortableCluster: Component<{
  cluster: DockBranchCluster;
  flatIndexOf: ReadonlyMap<TerminalId, number>;
}> = (props) => {
  const sortable = createSortable(props.cluster.label);
  const focus = useDockFocus();
  return (
    <DockCluster
      label={props.cluster.label}
      ref={sortable.ref}
      style={maybeTransformStyle(sortable.transform)}
      handlers={sortable.dragActivators}
    >
      <Key each={props.cluster.rows} by={"id"}>
        {(row) => (
          <>
            <DockRow
              id={row().id}
              bucket={row().bucket}
              pip={row().pip}
              recencyAt={row().ts}
              flatIndex={props.flatIndexOf.get(row().id) ?? -1}
            />
            <Key each={row().subRows} by={"id"}>
              {(sub) => (
                <DockSubRow row={sub()} tileId={row().id} onSelect={focus} />
              )}
            </Key>
          </>
        )}
      </Key>
    </DockCluster>
  );
};

const DockSubRow: Component<{
  row: RankedDockRow["subRows"][number];
  tileId: TerminalId;
  onSelect: (id: TerminalId) => void;
}> = (props) => {
  const drag = useDockRowDrag(props.row.id);
  return (
    <SubTerminalRow
      row={props.row}
      tileId={props.tileId}
      surface="desktop"
      onSelect={props.onSelect}
      drag={drag}
    />
  );
};

const DockRow: Component<{
  id: TerminalId;
  bucket: DockRowBucket;
  pip: DockRowBucket;
  recencyAt: number | null;
  flatIndex: number;
}> = (props) => {
  const tileStore = useTileStore();
  const combined = createDockRowData(props.id);
  const modHeld = useModHeld();
  const rowBag = useDockRowBag();
  return (
    <Show when={combined()}>
      {(c) => {
        const bag = rowBag({
          id: props.id,
          combined: c,
          bucket: () => props.bucket,
          pipBucket: () => props.pip,
          recencyAt: () => props.recencyAt,
        });
        const drag = useDockRowDrag(props.id);
        return (
          <DockRowView
            {...bag}
            surface="desktop"
            ref={drag.ref}
            handle={drag.handle}
            drop={drag.drop}
            onSelect={() => tileStore.activate(props.id)}
            overlay={
              <DockShortcutHint
                flatIndex={props.flatIndex}
                modHeld={modHeld}
                class="absolute top-0.5 left-0.5 inline-flex items-center justify-center h-3.5 min-w-3.5 px-1 rounded bg-accent text-surface-1 font-mono text-[0.55rem] font-bold tabular-nums pointer-events-none"
              />
            }
            testIds={{
              row: "dock-row",
              agentSubline: "dock-agent-subline",
              quietSubline: "dock-quiet-foreground",
            }}
            title="Jump to this terminal"
          />
        );
      }}
    </Show>
  );
};

const RailSectionMark: Component<{ color: string; name: string }> = (props) => (
  <div
    aria-hidden="true"
    data-testid="dock-rail-section"
    data-repo={props.name}
    class="dock-rail-section-mark"
    style={{ "--repo-color": props.color }}
    title={props.name}
  />
);

export const RailSubChip: Component<{
  row: Extract<DockGroup["railEntries"][number], { kind: "split" }>["row"];
  repoColor: string;
}> = (props) => {
  const store = useTerminalStore();
  const focus = useDockFocus();
  const meta = () => store.getMetadata(props.row.id);
  const unread = () => store.isUnread(props.row.id);
  return (
    <Show when={meta()}>
      {(m) => {
        const label = () => dockRowLabel(m(), undefined);
        const glyph = () => intentLeadGlyph(label());
        const pip = useStatePip(
          encActiveHost,
          () => props.row.id,
          m,
          unread,
          () => props.row.pip,
        );
        return (
          <button
            type="button"
            data-testid="dock-rail-sub"
            data-terminal-id={props.row.id}
            data-bucket={props.row.pip}
            data-motion={pip().motion}
            data-agent-state={activeArm(m())?.agent?.state}
            data-active={isActiveRow(props.row.id) ? "" : undefined}
            data-unread={unread() ? "" : undefined}
            onClick={() => focus(props.row.id)}
            class="dock-rail-chip w-[26px]! h-[26px]! rounded-[7px]! -mt-px"
            style={{ "--repo-color": props.repoColor }}
            title={`Split · ${label()}`}
            aria-label={`Jump to split ${label()}`}
          >
            <span class="dock-rail-chip-text text-[11px]!" aria-hidden="true">
              ↳
              <Show when={glyph()}>
                {(value) => <span class="dock-rail-chip-sub">{value()}</span>}
              </Show>
            </span>
            <Show when={pip().bytesLive}>
              <span class="pointer-events-none absolute -bottom-1 -right-1">
                <LiveActivityDot />
              </span>
            </Show>
            <Show when={pip().motion !== "none"}>
              <div class="dock-rail-chip-glow" aria-hidden="true" />
            </Show>
          </button>
        );
      }}
    </Show>
  );
};

const RailChip: Component<{
  id: TerminalId;
  pip: DockRowBucket;
  flatIndex: number;
}> = (props) => {
  const store = useTerminalStore();
  const tileStore = useTileStore();
  const combined = createDockRowData(props.id);
  const unread = () => store.isUnread(props.id);
  const modHeld = useModHeld();
  return (
    <Show when={combined()}>
      {(c) => {
        const labels = () => chipInitials(c().meta, c().info);
        const pip = useStatePip(
          encActiveHost,
          () => props.id,
          () => c().meta,
          unread,
          () => props.pip,
        );
        return (
          <button
            type="button"
            data-testid="dock-rail"
            data-terminal-id={props.id}
            data-bucket={props.pip}
            data-motion={pip().motion}
            data-agent-state={activeArm(c().meta)?.agent?.state}
            data-active={isActiveRow(props.id) ? "" : undefined}
            data-unread={unread() ? "" : undefined}
            onClick={() => tileStore.activate(props.id)}
            class="dock-rail-chip"
            style={{ "--repo-color": c().info.repoColor }}
            title={chipTooltip(c().info, props.pip)}
            aria-label={chipTooltip(c().info, props.pip)}
          >
            <DockShortcutHint
              flatIndex={props.flatIndex}
              modHeld={modHeld}
              class="dock-rail-chip-hint"
            />
            <span class="dock-rail-chip-text" aria-hidden="true">
              {labels().repo}
              <span
                class="dock-rail-chip-sub"
                data-glyph={labels().subIsGlyph ? "" : undefined}
              >
                {labels().sub}
              </span>
            </span>
            <Show when={pip().bytesLive}>
              <span class="pointer-events-none absolute -bottom-1 -right-1">
                <LiveActivityDot />
              </span>
            </Show>
            <Show when={pip().motion !== "none"}>
              <div class="dock-rail-chip-glow" aria-hidden="true" />
            </Show>
          </button>
        );
      }}
    </Show>
  );
};

function chipTooltip(info: TerminalDisplayInfo, bucket: DockRowBucket): string {
  return `${info.key.group} · ${info.key.label} · ${bucket}`;
}

export default Dock;
