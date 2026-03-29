import { type Component, For, Show, createSignal } from "solid-js";
import {
  DragDropProvider,
  DragDropSensors,
  DragOverlay,
  SortableProvider,
  createSortable,
  closestCenter,
  type DragEvent,
} from "@thisbeyond/solid-dnd";
import Tip from "./Tip";
import TerminalMeta from "./TerminalMeta";
import { useTips } from "./useTips";
import { sidebarSwitchTip } from "./tips";
import { cwdBasename } from "./path";
import type { TerminalDisplayInfo } from "./terminalDisplay";
import type { TerminalId, TerminalInfo, TerminalMetadata } from "kolu-common";

/** Single sortable sidebar entry. Extracted so `createSortable` runs inside `<For>`. */
const SidebarEntry: Component<{
  id: TerminalId;
  isActive: boolean;
  meta: Omit<TerminalInfo, "id"> | undefined;
  displayInfo: TerminalDisplayInfo | undefined;
  onSelect: (id: TerminalId) => void;
  /** "above" | "below" | null — where the drop line should render on this entry */
  dropEdge: "above" | "below" | null;
  /** Child terminal IDs for this workspace. */
  subTerminalIds: TerminalId[];
  /** Whether the child terminal list is expanded. */
  expanded: boolean;
  onToggleExpand: () => void;
  onCreateTerminal: () => void;
  getSubMeta: (id: TerminalId) => { meta?: TerminalMetadata } | undefined;
  onSelectTerminal: (subId: TerminalId) => void;
}> = (props) => {
  const sortable = createSortable(props.id);
  const m = () => props.meta;
  const hasChildren = () => props.subTerminalIds.length > 0;

  return (
    <div class="relative" style={sortable.style}>
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
      <div class="group flex items-stretch border-b border-edge">
        <button
          ref={sortable.ref}
          {...sortable.dragActivators}
          data-terminal-id={props.id}
          data-active={props.isActive ? "" : undefined}
          data-activity={m()?.isActive ? "active" : "sleeping"}
          class="flex-1 min-w-0 py-2 px-2 text-sm text-left transition-colors duration-150 touch-none"
          classList={{
            "border-l-4 bg-accent/10 text-fg": props.isActive,
            "border-l-4 border-l-transparent text-fg-3 hover:text-fg-2 hover:bg-surface-2":
              !props.isActive,
            "opacity-25": sortable.isActiveDraggable,
          }}
          style={{
            "border-left-color":
              props.displayInfo?.repoColor ??
              (props.isActive ? "var(--accent)" : "transparent"),
          }}
          onClick={() => props.onSelect(props.id)}
          onMouseDown={(e) => e.preventDefault()}
          title={m()?.meta?.cwd ?? String(props.id)}
        >
          <TerminalMeta info={props.displayInfo} />
        </button>
        {/* Action buttons — visible on hover/focus */}
        <div
          class="flex items-center gap-0.5 pr-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity"
          classList={{ "opacity-100": props.isActive }}
        >
          <button
            data-testid="add-terminal"
            class="p-1 text-fg-3 hover:text-fg rounded transition-colors"
            title="New terminal"
            onClick={(e) => {
              e.stopPropagation();
              props.onCreateTerminal();
            }}
          >
            <svg class="w-3.5 h-3.5" viewBox="0 0 16 16" fill="currentColor">
              <path d="M8 2a.75.75 0 0 1 .75.75v4.5h4.5a.75.75 0 0 1 0 1.5h-4.5v4.5a.75.75 0 0 1-1.5 0v-4.5h-4.5a.75.75 0 0 1 0-1.5h4.5v-4.5A.75.75 0 0 1 8 2Z" />
            </svg>
          </button>
          <Show when={hasChildren()}>
            <button
              data-testid="toggle-expand"
              class="p-1 text-fg-3 hover:text-fg rounded transition-colors"
              title={props.expanded ? "Collapse terminals" : "Expand terminals"}
              onClick={(e) => {
                e.stopPropagation();
                props.onToggleExpand();
              }}
            >
              <svg
                class="w-3 h-3 transition-transform"
                classList={{ "rotate-90": props.expanded }}
                viewBox="0 0 16 16"
                fill="currentColor"
              >
                <path d="M6.22 4.22a.75.75 0 0 1 1.06 0l3.5 3.5a.75.75 0 0 1 0 1.06l-3.5 3.5a.75.75 0 0 1-1.06-1.06L9.44 8 6.22 4.78a.75.75 0 0 1 0-1.06Z" />
              </svg>
            </button>
          </Show>
        </div>
      </div>
      {/* Nested terminal list when expanded */}
      <Show when={props.expanded && hasChildren()}>
        <div data-testid="terminal-list" class="bg-surface-0/50">
          <For each={props.subTerminalIds}>
            {(subId) => {
              const subMeta = () => props.getSubMeta(subId);
              const label = () => {
                const m = subMeta();
                return m?.meta ? cwdBasename(m.meta.cwd) : "terminal";
              };
              return (
                <button
                  data-testid="terminal-entry"
                  class="w-full pl-6 pr-2 py-1.5 text-xs text-fg-3 hover:text-fg-2 hover:bg-surface-2 text-left truncate transition-colors"
                  onClick={() => props.onSelectTerminal(subId)}
                  title={subMeta()?.meta?.cwd}
                >
                  {label()}
                </button>
              );
            }}
          </For>
        </div>
      </Show>
    </div>
  );
};

/** Sidebar — collapsible workspace list with drag-to-reorder. */
const Sidebar: Component<{
  terminalIds: TerminalId[];
  activeId: TerminalId | null;
  getMeta: (id: TerminalId) => Omit<TerminalInfo, "id"> | undefined;
  getDisplayInfo: (id: TerminalId) => TerminalDisplayInfo | undefined;
  onSelect: (id: TerminalId) => void;
  onCreate: () => void;
  onReorder: (ids: TerminalId[]) => void;
  open: boolean;
  onClose: () => void;
  getSubTerminalIds: (id: TerminalId) => TerminalId[];
  getSubMeta: (id: TerminalId) => { meta?: TerminalMetadata } | undefined;
  onCreateTerminal: (parentId: TerminalId) => void;
  onSelectTerminal: (parentId: TerminalId, subId: TerminalId) => void;
}> = (props) => {
  const { showTipOnce } = useTips();

  // Local expanded state — not persisted, collapsed by default
  const [expandedSet, setExpandedSet] = createSignal<Set<TerminalId>>(
    new Set(),
  );

  function isExpanded(id: TerminalId) {
    return expandedSet().has(id);
  }

  function toggleExpand(id: TerminalId) {
    setExpandedSet((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

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
        <Tip label="New workspace" class="w-full">
          <button
            data-testid="create-workspace"
            class="p-2 text-sm text-fg-2 hover:text-fg hover:bg-surface-2 transition-colors text-left border-b border-edge focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/50 w-full"
            onClick={props.onCreate}
          >
            + New workspace
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
                      meta={props.getMeta(id)}
                      displayInfo={props.getDisplayInfo(id)}
                      onSelect={handleSelect}
                      dropEdge={edge()}
                      subTerminalIds={props.getSubTerminalIds(id)}
                      expanded={isExpanded(id)}
                      onToggleExpand={() => toggleExpand(id)}
                      onCreateTerminal={() => props.onCreateTerminal(id)}
                      getSubMeta={props.getSubMeta}
                      onSelectTerminal={(subId) =>
                        props.onSelectTerminal(id, subId)
                      }
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
                        {d()?.name ?? "workspace"}
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
