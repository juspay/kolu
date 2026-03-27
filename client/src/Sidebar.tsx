import { type Component, For, Show, createMemo, createSignal } from "solid-js";
import {
  DragDropProvider,
  DragDropSensors,
  DragOverlay,
  SortableProvider,
  createSortable,
  closestCenter,
  type DragEvent,
} from "@thisbeyond/solid-dnd";
import {
  cwdBasename,
  terminalName,
  buildRepoColorMap,
  buildBranchColorMap,
} from "./path";
import Tip from "./Tip";
import ChecksIndicator from "./ChecksIndicator";
import ActivityGraph from "./ActivityGraph";
import type { TerminalId, TerminalInfo } from "kolu-common";
import type { ActivitySample } from "./useTerminals";

/** Single sortable sidebar entry. Extracted so `createSortable` runs inside `<For>`. */
const SidebarEntry: Component<{
  id: TerminalId;
  isActive: boolean;
  meta: Omit<TerminalInfo, "id"> | undefined;
  onSelect: (id: TerminalId) => void;
  activityHistory: ActivitySample[];
  /** Number of sub-terminals attached to this terminal. */
  subCount: number;
  /** "above" | "below" | null — where the drop line should render on this entry */
  dropEdge: "above" | "below" | null;
  repoColor: string | undefined;
  branchColor: string | undefined;
}> = (props) => {
  const sortable = createSortable(props.id);
  const m = () => props.meta;
  const repoColor = () => props.repoColor;
  const branchColor = () => props.branchColor;

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
      <button
        ref={sortable.ref}
        {...sortable.dragActivators}
        data-terminal-id={props.id}
        data-active={props.isActive ? "" : undefined}
        data-activity={m()?.isActive ? "active" : "sleeping"}
        class="group w-full py-2 px-2 text-sm text-left transition-colors duration-150 touch-none border-b border-edge"
        classList={{
          "border-l-4 bg-accent/10 text-fg": props.isActive,
          "border-l-4 border-l-transparent text-fg-3 hover:text-fg-2 hover:bg-surface-2":
            !props.isActive,
          "opacity-25": sortable.isActiveDraggable,
        }}
        style={{
          "border-left-color":
            repoColor() ?? (props.isActive ? "var(--accent)" : "transparent"),
        }}
        onClick={() => props.onSelect(props.id)}
        onMouseDown={(e) => e.preventDefault()}
        title={m()?.meta?.cwd ?? String(props.id)}
      >
        <div class="flex items-center gap-1.5 text-sm font-medium truncate">
          <Show when={m()?.meta}>
            {(metadata) => (
              <span
                data-testid="sidebar-label"
                class="truncate"
                style={{ color: repoColor() }}
              >
                {metadata().git?.repoName ?? cwdBasename(metadata().cwd)}
              </span>
            )}
          </Show>
          <Show when={m()?.meta?.git?.isWorktree}>
            <span
              data-testid="worktree-indicator"
              class="text-fg-3 shrink-0"
              title="Worktree"
            >
              <svg
                class="w-3 h-3"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M13 10V3L4 14h7v7l9-11h-7z"
                />
              </svg>
            </span>
          </Show>
          {/* Sub-terminal count badge */}
          <Show when={props.subCount > 0}>
            <span
              data-testid="sub-count"
              class="ml-auto text-[0.6rem] text-fg-3 bg-surface-2 px-1 rounded shrink-0"
            >
              +{props.subCount}
            </span>
          </Show>
        </div>
        <div
          data-testid="sidebar-branch"
          class="text-xs truncate"
          title={m()?.meta?.git?.branch}
          style={{ color: branchColor() }}
          classList={{ "text-fg-2": !branchColor() }}
        >
          {m()?.meta?.git?.branch ?? "\u00A0"}
        </div>
        <Show when={m()?.meta?.pr}>
          {(pr) => (
            <div
              class="flex items-center gap-1 text-xs text-fg-3 truncate"
              data-testid="sidebar-pr"
              title={`#${pr().number} ${pr().title}`}
            >
              <Show when={pr().checks}>
                {(checks) => <ChecksIndicator status={checks()} />}
              </Show>
              <a
                href={pr().url}
                target="_blank"
                rel="noopener noreferrer"
                class="hover:text-accent shrink-0"
                onClick={(e) => e.stopPropagation()}
              >
                #{pr().number}
              </a>
              <span class="truncate">{pr().title}</span>
            </div>
          )}
        </Show>
        <Show when={props.activityHistory.length > 0}>
          <div class="mt-0.5">
            <ActivityGraph samples={props.activityHistory} />
          </div>
        </Show>
      </button>
    </div>
  );
};

/** Sidebar — collapsible terminal list with drag-to-reorder. */
const Sidebar: Component<{
  terminalIds: TerminalId[];
  activeId: TerminalId | null;
  getMeta: (id: TerminalId) => Omit<TerminalInfo, "id"> | undefined;
  getActivityHistory: (id: TerminalId) => ActivitySample[];
  getSubTerminalIds: (id: TerminalId) => TerminalId[];
  onSelect: (id: TerminalId) => void;
  onCreate: () => void;
  onReorder: (ids: TerminalId[]) => void;
  open: boolean;
  onClose: () => void;
}> = (props) => {
  const colorMap = createMemo(() =>
    buildRepoColorMap(props.terminalIds, props.getMeta),
  );
  const branchMap = createMemo(() =>
    buildBranchColorMap(props.terminalIds, props.getMeta),
  );

  function colorFor(
    meta: Omit<TerminalInfo, "id"> | undefined,
  ): string | undefined {
    const key = terminalName(meta);
    return key ? colorMap().get(key) : undefined;
  }

  function branchColorFor(
    meta: Omit<TerminalInfo, "id"> | undefined,
  ): string | undefined {
    const branch = meta?.meta?.git?.branch;
    return branch ? branchMap().get(branch) : undefined;
  }

  function handleSelect(id: TerminalId) {
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
        class="flex flex-col w-52 bg-surface-1 transition-transform duration-200 ease-out z-40"
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
                      meta={props.getMeta(id)}
                      activityHistory={props.getActivityHistory(id)}
                      subCount={props.getSubTerminalIds(id).length}
                      onSelect={handleSelect}
                      dropEdge={edge()}
                      repoColor={colorFor(props.getMeta(id))}
                      branchColor={branchColorFor(props.getMeta(id))}
                    />
                  );
                }}
              </For>
            </SortableProvider>
            <DragOverlay>
              <Show when={activeItem()}>
                {(dragId) => {
                  const dm = () => props.getMeta(dragId());
                  const color = () => colorFor(dm());
                  return (
                    <div
                      class="py-1.5 px-2 text-sm bg-surface-2 border border-edge rounded shadow-lg"
                      style={{ "border-left-color": color() }}
                    >
                      <span style={{ color: color() }}>
                        {terminalName(dm()) ?? "terminal"}
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
