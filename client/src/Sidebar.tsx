import { type Component, For, Show, createSignal } from "solid-js";
import {
  DragDropProvider,
  DragDropSensors,
  DragOverlay,
  SortableProvider,
  createSortable,
  closestCenter,
  type DragEvent,
  type Id,
} from "@thisbeyond/solid-dnd";
import { cwdBasename } from "./path";
import { formatKeybind } from "./keyboard";
import Tip from "./Tip";
import type { TerminalId, TerminalInfo } from "kolu-common";

/** Stable hash → hue (0-360) for a string. Same string always gets the same color. */
function stringToHue(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return ((h % 360) + 360) % 360;
}

/** Single sortable sidebar entry. Extracted so `createSortable` runs inside `<For>`. */
const SidebarEntry: Component<{
  id: TerminalId;
  index: number;
  isActive: boolean;
  meta: Omit<TerminalInfo, "id"> | undefined;
  onSelect: (id: TerminalId) => void;
  onKill: (id: TerminalId) => void;
}> = (props) => {
  const sortable = createSortable(props.id);
  const m = () => props.meta;
  const pos = () => props.index + 1;
  const shortcutLabel = () =>
    pos() <= 9 ? formatKeybind({ mod: true, key: String(pos()) }) : undefined;
  const repoColor = () => {
    const key = m()?.cwd?.git?.repoName ?? cwdBasename(m()?.cwd?.cwd ?? "");
    return key ? `hsl(${stringToHue(key)} 60% 65%)` : undefined;
  };

  return (
    <button
      ref={sortable.ref}
      {...sortable.dragActivators}
      data-terminal-id={props.id}
      class="group w-full py-1.5 px-2 text-sm text-left transition-colors duration-150 touch-none"
      classList={{
        "border-l-[3px] bg-surface-2 text-fg": props.isActive,
        "border-l-2 text-fg-2 hover:text-fg hover:bg-surface-2":
          !props.isActive,
        "opacity-25": sortable.isActiveDraggable,
      }}
      style={{
        "border-left-color":
          repoColor() ?? (props.isActive ? "var(--accent)" : "transparent"),
        ...sortable.style,
      }}
      onClick={() => props.onSelect(props.id)}
      onMouseDown={(e) => e.preventDefault()}
      title={m()?.cwd?.cwd ?? String(props.id)}
    >
      <Show when={m()?.cwd}>
        {(cwdInfo) => (
          <div class="flex items-center gap-1.5 text-sm font-medium truncate">
            <span
              data-testid="activity-indicator"
              class="inline-block w-2 h-2 rounded-full shrink-0 transition-colors duration-300"
              classList={{
                "bg-ok animate-activity-pulse": m()?.isActive ?? false,
                "bg-fg-3": !(m()?.isActive ?? false),
              }}
            />
            <span class="truncate" style={{ color: repoColor() }}>
              {cwdBasename(cwdInfo().cwd)}
              <Show when={cwdInfo().git}>
                {(git) => (
                  <span data-testid="sidebar-branch" class="text-fg-2">
                    {" "}
                    &middot; {git().branch}
                  </span>
                )}
              </Show>
            </span>
            <Tip label="Close terminal">
              <span
                data-testid="close-terminal"
                class="opacity-0 group-hover:opacity-100 hover:text-danger text-fg-3 px-0.5 transition-opacity duration-150"
                onClick={(e) => {
                  e.stopPropagation();
                  if (confirm("Close this terminal?")) props.onKill(props.id);
                }}
                onMouseDown={(e) => e.preventDefault()}
              >
                ×
              </span>
            </Tip>
          </div>
        )}
      </Show>
      <div class="flex items-center gap-1.5">
        <Show when={!m()?.cwd}>
          <span
            data-testid="activity-indicator"
            class="inline-block w-2 h-2 rounded-full shrink-0 transition-colors duration-300"
            classList={{
              "bg-ok animate-activity-pulse": m()?.isActive ?? false,
              "bg-fg-3": !(m()?.isActive ?? false),
            }}
          />
        </Show>
        <Show when={shortcutLabel()}>
          {(label) => <span class="text-xs text-fg-3 ml-3.5">{label()}</span>}
        </Show>
      </div>
    </button>
  );
};

/** Sidebar — collapsible terminal list with drag-to-reorder. */
const Sidebar: Component<{
  terminalIds: TerminalId[];
  activeId: TerminalId | null;
  getMeta: (id: TerminalId) => Omit<TerminalInfo, "id"> | undefined;
  onSelect: (id: TerminalId) => void;
  onKill: (id: TerminalId) => void;
  onCreate: () => void;
  onReorder: (ids: TerminalId[]) => void;
  open: boolean;
  onClose: () => void;
}> = (props) => {
  function handleSelect(id: TerminalId) {
    props.onSelect(id);
    if (window.innerWidth < 640) props.onClose();
  }

  const [activeItem, setActiveItem] = createSignal<TerminalId | null>(null);

  function handleDragEnd({ draggable, droppable }: DragEvent) {
    setActiveItem(null);
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
        class="flex flex-col w-44 bg-surface-1 border-r border-edge transition-transform duration-200 ease-out z-40"
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
            onDragStart={({ draggable }) =>
              setActiveItem(draggable.id as TerminalId)
            }
            onDragEnd={handleDragEnd}
          >
            <DragDropSensors />
            <SortableProvider ids={props.terminalIds as unknown as Id[]}>
              <For each={props.terminalIds}>
                {(id, index) => (
                  <SidebarEntry
                    id={id}
                    index={index()}
                    isActive={props.activeId === id}
                    meta={props.getMeta(id)}
                    onSelect={handleSelect}
                    onKill={props.onKill}
                  />
                )}
              </For>
            </SortableProvider>
            <DragOverlay>
              <Show when={activeItem()}>
                {(dragId) => {
                  const dm = () => props.getMeta(dragId());
                  const dragRepoColor = () => {
                    const key =
                      dm()?.cwd?.git?.repoName ??
                      cwdBasename(dm()?.cwd?.cwd ?? "");
                    return key ? `hsl(${stringToHue(key)} 60% 65%)` : undefined;
                  };
                  return (
                    <div
                      class="py-1.5 px-2 text-sm bg-surface-2 border border-edge rounded shadow-lg"
                      style={{ "border-left-color": dragRepoColor() }}
                    >
                      <span style={{ color: dragRepoColor() }}>
                        {cwdBasename(dm()?.cwd?.cwd ?? "") || "terminal"}
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
