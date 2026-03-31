import { type Component, For, Show, createSignal } from "solid-js";
import {
  DragDropProvider,
  DragDropSensors,
  DragOverlay,
  SortableProvider,
  createSortable,
  closestCenter,
  transformStyle,
  type DragEvent,
} from "@thisbeyond/solid-dnd";
import Tip from "./Tip";
import TerminalMeta from "./TerminalMeta";
import { useTips } from "./useTips";
import { sidebarSwitchTip } from "./tips";
import type { TerminalDisplayInfo } from "./terminalDisplay";
import type { TerminalId, TerminalMetadata } from "kolu-common";

/** Single sortable sidebar entry. Extracted so `createSortable` runs inside `<For>`. */
const SidebarEntry: Component<{
  id: TerminalId;
  isActive: boolean;
  metadata: TerminalMetadata | undefined;
  alerting: boolean;
  displayInfo: TerminalDisplayInfo | undefined;
  onSelect: (id: TerminalId) => void;
  /** "above" | "below" | null — where the drop line should render on this entry */
  dropEdge: "above" | "below" | null;
}> = (props) => {
  const sortable = createSortable(props.id);

  return (
    <div class="relative" style={transformStyle(sortable.transform)}>
      {/* Drop indicator line — positioned at the edge where the item will be inserted */}
      <Show when={props.dropEdge}>
        {(edge) => (
          <div
            class="absolute left-1 right-1 h-0.5 bg-accent rounded-full"
            classList={{
              "top-0": edge() === "above",
              "bottom-0": edge() === "below",
            }}
          />
        )}
      </Show>
      <button
        ref={sortable.ref}
        {...sortable.dragActivators}
        data-terminal-id={props.id}
        data-active={props.isActive ? "" : undefined}
        data-activity={
          props.displayInfo?.activityHistory.at(-1)?.[1] ? "active" : "sleeping"
        }
        data-alerting={props.alerting ? "" : undefined}
        class="group w-full py-2 px-2 text-sm text-left transition-colors duration-150 touch-none border-b border-edge"
        classList={{
          "border-l-4 bg-accent/10 text-fg": props.isActive,
          "border-l-4 border-l-transparent hover:bg-surface-2": !props.isActive,
          "text-fg": !props.isActive && !!props.alerting,
          "text-fg-3 hover:text-fg-2": !props.isActive && !props.alerting,
          "opacity-25": sortable.isActiveDraggable,
        }}
        style={{
          "border-left-color": props.alerting
            ? "var(--color-accent)"
            : (props.displayInfo?.repoColor ??
              (props.isActive ? "var(--accent)" : "transparent")),
          ...(props.alerting
            ? { animation: "alerting-glow 1.5s ease-in-out infinite" }
            : {}),
        }}
        onClick={() => props.onSelect(props.id)}
        onMouseDown={(e) => e.preventDefault()}
        title={props.metadata?.cwd ?? String(props.id)}
      >
        <TerminalMeta info={props.displayInfo} />
      </button>
    </div>
  );
};

/** Sidebar — collapsible terminal list with drag-to-reorder. */
const Sidebar: Component<{
  terminalIds: TerminalId[];
  activeId: TerminalId | null;
  getMetadata: (id: TerminalId) => TerminalMetadata | undefined;
  needsAttention: (id: TerminalId) => boolean;
  getDisplayInfo: (id: TerminalId) => TerminalDisplayInfo | undefined;
  onSelect: (id: TerminalId) => void;
  onCreate: () => void;
  onReorder: (ids: TerminalId[]) => void;
  open: boolean;
  onClose: () => void;
}> = (props) => {
  const { showTipOnce } = useTips();

  function handleSelect(id: TerminalId) {
    const idx = props.terminalIds.indexOf(id);
    if (idx >= 0 && idx < 9) showTipOnce(sidebarSwitchTip(idx));
    props.onSelect(id);
    if (window.innerWidth < 640) props.onClose();
  }

  const [dragFrom, setDragFrom] = createSignal<number | null>(null);
  const [dropTarget, setDropTarget] = createSignal<TerminalId | null>(null);
  const [activeItem, setActiveItem] = createSignal<TerminalId | null>(null);

  function handleDragEnd({ draggable, droppable }: DragEvent) {
    setActiveItem(null);
    setDragFrom(null);
    setDropTarget(null);
    if (!draggable || !droppable || draggable.id === droppable.id) return;
    const ids = props.terminalIds;
    const fromIdx = ids.indexOf(draggable.id as TerminalId);
    const toIdx = ids.indexOf(droppable.id as TerminalId);
    if (fromIdx === -1 || toIdx === -1) return;
    const reordered = [...ids];
    const [moved] = reordered.splice(fromIdx, 1);
    reordered.splice(toIdx, 0, moved!);
    props.onReorder(reordered);
  }

  return (
    <>
      {/* Backdrop — mobile only, shown when sidebar is open */}
      <Show when={props.open}>
        <div
          data-testid="sidebar-backdrop"
          class="absolute inset-0 bg-black/50 z-30 sm:hidden"
          onClick={() => props.onClose()}
        />
      </Show>

      {/* Sidebar panel — absolute within content area on mobile, in-flow on desktop */}
      <aside
        data-testid="sidebar"
        class="flex flex-col w-48 lg:w-56 xl:w-60 bg-surface-1 transition-transform duration-200 ease-out z-40"
        classList={{
          "absolute inset-y-0 left-0 sm:relative sm:inset-auto": true,
          "-translate-x-full sm:hidden": !props.open,
          "translate-x-0": props.open,
        }}
      >
        <Tip label="New terminal" class="w-full">
          <button
            data-testid="create-terminal"
            class="p-2 text-sm text-fg-2 hover:text-fg hover:bg-surface-2 transition-colors text-left border-b border-edge focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/50 w-full"
            onClick={props.onCreate}
          >
            + New terminal
          </button>
        </Tip>
        <nav class="flex-1 overflow-y-auto">
          <DragDropProvider
            collisionDetector={closestCenter}
            onDragStart={({ draggable }) => {
              setActiveItem(draggable.id as TerminalId);
              setDragFrom(
                props.terminalIds.indexOf(draggable.id as TerminalId),
              );
            }}
            onDragOver={({ droppable }) =>
              setDropTarget(droppable ? (droppable.id as TerminalId) : null)
            }
            onDragEnd={handleDragEnd}
          >
            <DragDropSensors />
            <SortableProvider ids={props.terminalIds}>
              <For each={props.terminalIds}>
                {(id, index) => {
                  const edge = (): "above" | "below" | null => {
                    const from = dragFrom();
                    const target = dropTarget();
                    if (from === null || target !== id) return null;
                    const toIdx = index();
                    return from > toIdx ? "above" : "below";
                  };
                  return (
                    <SidebarEntry
                      id={id}
                      isActive={props.activeId === id}
                      metadata={props.getMetadata(id)}
                      alerting={props.needsAttention(id)}
                      displayInfo={props.getDisplayInfo(id)}
                      onSelect={handleSelect}
                      dropEdge={edge()}
                    />
                  );
                }}
              </For>
            </SortableProvider>
            <DragOverlay>
              <Show when={activeItem()}>
                {(dragId) => {
                  const d = () => props.getDisplayInfo(dragId());
                  return (
                    <div
                      class="py-1.5 px-2 text-sm bg-surface-2 border border-edge rounded shadow-lg"
                      style={{ "border-left-color": d()?.repoColor }}
                    >
                      <span style={{ color: d()?.repoColor }}>
                        {d()?.name ?? "terminal"}
                      </span>
                    </div>
                  );
                }}
              </Show>
            </DragOverlay>
          </DragDropProvider>
        </nav>
      </aside>
    </>
  );
};

export default Sidebar;
