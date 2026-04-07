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
import { match, P } from "ts-pattern";
import Tip from "./Tip";
import Kbd from "./Kbd";
import TerminalMeta from "./TerminalMeta";
import TerminalPreview from "./TerminalPreview";
import { useTips } from "./useTips";
import { sidebarSwitchTip } from "./tips";
import { formatKeybind, SHORTCUTS } from "./keyboard";
import type { TerminalDisplayInfo } from "./terminalDisplay";
import type { ClaudeCodeInfo, TerminalId, TerminalMetadata } from "kolu-common";
import type { ITheme } from "@xterm/xterm";
import type { TerminalDimensions } from "./useViewState";

type ClaudeState = ClaudeCodeInfo["state"];
type CardTier = "waiting" | "active" | "idle";

/** Derive the visual tier for the sidebar card from live Claude state.
 *  Note: `unread` (unseen completion) is orthogonal — rendered as a
 *  separate dot, not folded into this tier. */
function cardTier(claudeState: ClaudeState | undefined): CardTier {
  return match(claudeState)
    .with("waiting", () => "waiting" as const)
    .with(P.union("thinking", "tool_use"), () => "active" as const)
    .with(undefined, () => "idle" as const)
    .exhaustive();
}

/** Single sortable sidebar entry — floating card with spinning border for agent states. */
const SidebarEntry: Component<{
  id: TerminalId;
  isActive: boolean;
  metadata: TerminalMetadata | undefined;
  unread: boolean;
  displayInfo: TerminalDisplayInfo | undefined;
  terminalTheme: ITheme;
  /** When true, agent terminals render a live xterm preview above the meta. */
  showAgentPreview: boolean;
  /** Current cols×rows of the main terminal — preview mirrors these exactly. */
  dimensions: TerminalDimensions | undefined;
  onSelect: (id: TerminalId) => void;
  onClose: (id: TerminalId) => void;
  dropEdge: "above" | "below" | null;
}> = (props) => {
  /** Agent terminals get a live preview above the meta — lets the user watch
   *  what their agents are saying without switching terminals. Non-agent
   *  terminals keep the compact meta-only card to save vertical space. The
   *  preview only renders once dimensions are known, so the preview xterm
   *  can size itself to match the main terminal exactly. */
  const showPreview = () =>
    props.showAgentPreview &&
    props.metadata?.claude != null &&
    props.dimensions !== undefined;
  const sortable = createSortable(props.id);
  const tier = () => cardTier(props.displayInfo?.meta.claude?.state);

  return (
    <div
      class="relative py-1 pl-1.5"
      classList={{
        "pr-0": props.isActive,
        "pr-1.5": !props.isActive,
      }}
      style={transformStyle(sortable.transform)}
    >
      <Show when={props.dropEdge}>
        {(edge) => (
          <div
            class="absolute left-2 right-2 h-0.5 bg-accent rounded-full z-10"
            classList={{
              "top-0": edge() === "above",
              "bottom-0": edge() === "below",
            }}
          />
        )}
      </Show>

      {/* Unread dot — sits in the left gutter beside the card so it doesn't
       *  overlap any card content or the close button. */}
      <Show when={props.unread}>
        <span
          data-testid="unread-dot"
          class="absolute left-0 top-1/2 -translate-y-1/2 flex h-2 w-2 z-20"
          title="Unread completion"
        >
          <span class="absolute inline-flex h-full w-full rounded-full bg-alert opacity-75 animate-ping" />
          <span class="relative inline-flex rounded-full h-2 w-2 bg-alert" />
        </span>
      </Show>

      {/* Spinning border container — conic gradient rotates behind the card */}
      <div
        class="card-border-wrap transition-all duration-200"
        classList={{
          "rounded-2xl": !props.isActive,
          "rounded-l-2xl rounded-r-none card-active": props.isActive,
          "card-spin-active": tier() === "active",
          "card-spin-waiting": tier() === "waiting",
          /* Active: lifted with depth (dark shadow) + identity (repo-colored glow) */
          "z-10 card-active-shadow": props.isActive,
        }}
        style={{
          "--card-color": props.displayInfo?.repoColor ?? "var(--color-accent)",
        }}
      >
        <button
          ref={sortable.ref}
          {...sortable.dragActivators}
          data-terminal-id={props.id}
          data-active={props.isActive ? "" : undefined}
          data-activity={
            props.displayInfo?.activityHistory.at(-1)?.[1]
              ? "active"
              : "sleeping"
          }
          data-unread={props.unread ? "" : undefined}
          class="group relative w-full text-sm text-left touch-none transition-all duration-200"
          classList={{
            "rounded-[14px]": !props.isActive,
            "rounded-l-[14px] rounded-r-none": props.isActive,
            "text-fg": props.isActive || tier() !== "idle",
            "text-fg-3 hover:text-fg-2": !props.isActive && tier() === "idle",
            "opacity-25": sortable.isActiveDraggable,
          }}
          style={{
            /* Active card uses the actual xterm theme bg — same material as the terminal.
             * --active-terminal-bg is published by App.tsx on the layout root. */
            "background-color": props.isActive
              ? "var(--active-terminal-bg)"
              : props.displayInfo?.repoColor
                ? `color-mix(in oklch, ${props.displayInfo.repoColor} 5%, var(--color-surface-1))`
                : "var(--color-surface-1)",
          }}
          onClick={() => props.onSelect(props.id)}
          onMouseDown={(e) => e.preventDefault()}
          title={props.metadata?.cwd ?? String(props.id)}
        >
          <Show when={showPreview()}>
            <div
              data-testid="sidebar-preview"
              class="mx-2.5 mt-2 h-40 rounded-lg overflow-hidden border border-edge bg-surface-0"
            >
              <TerminalPreview
                terminalId={props.id}
                theme={props.terminalTheme}
                cols={props.dimensions!.cols}
                rows={props.dimensions!.rows}
              />
            </div>
          </Show>
          <div class="min-w-0 px-2.5 py-2 pr-6">
            <TerminalMeta info={props.displayInfo} />
          </div>

          <span
            data-testid="sidebar-close"
            class="absolute top-2 right-2 hidden group-hover:flex items-center justify-center w-5 h-5 rounded-full text-fg-3 hover:text-fg hover:bg-surface-3 transition-colors cursor-pointer"
            onClick={(e) => {
              e.stopPropagation();
              props.onClose(props.id);
            }}
            title="Close terminal"
          >
            ×
          </span>
        </button>
      </div>
    </div>
  );
};

/** Sidebar — collapsible terminal list with drag-to-reorder. */
const Sidebar: Component<{
  terminalIds: TerminalId[];
  activeId: TerminalId | null;
  getMetadata: (id: TerminalId) => TerminalMetadata | undefined;
  isUnread: (id: TerminalId) => boolean;
  getDisplayInfo: (id: TerminalId) => TerminalDisplayInfo | undefined;
  getTerminalTheme: (id: TerminalId) => ITheme;
  getDimensions: (id: TerminalId) => TerminalDimensions | undefined;
  showAgentPreviews: boolean;
  onSelect: (id: TerminalId) => void;
  onCloseTerminal: (id: TerminalId) => void;
  onCreate: () => void;
  onNewTerminalMenu: () => void;
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
      <Show when={props.open}>
        <div
          data-testid="sidebar-backdrop"
          class="absolute inset-0 bg-black/50 z-30 sm:hidden"
          onClick={() => props.onClose()}
        />
      </Show>

      <aside
        data-testid="sidebar"
        class="flex flex-col w-52 lg:w-60 xl:w-64 bg-surface-0 transition-transform duration-200 ease-out z-40"
        classList={{
          "absolute inset-y-0 left-0 sm:relative sm:inset-auto": true,
          "-translate-x-full sm:hidden": !props.open,
          "translate-x-0": props.open,
        }}
      >
        <Tip label="New terminal" class="w-full">
          <div class="flex m-1.5 rounded-2xl bg-surface-1 overflow-hidden">
            <button
              data-testid="create-terminal"
              class="flex-1 p-2 text-sm text-fg-2 hover:text-fg hover:bg-surface-2 transition-colors text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/50"
              onClick={props.onCreate}
            >
              + New terminal
            </button>
            <div class="w-px my-1.5 bg-edge" />
            <button
              data-testid="new-terminal-menu"
              class="px-2.5 text-fg-3 hover:text-fg hover:bg-surface-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/50"
              onClick={props.onNewTerminalMenu}
              title="More options"
            >
              <svg
                class="w-3 h-3"
                viewBox="0 0 12 12"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <path d="M3 5l3 3 3-3" />
              </svg>
            </button>
          </div>
        </Tip>
        <nav class="flex-1 min-h-0 overflow-y-auto py-0.5 sidebar-scroll">
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
                      unread={props.isUnread(id)}
                      displayInfo={props.getDisplayInfo(id)}
                      terminalTheme={props.getTerminalTheme(id)}
                      showAgentPreview={props.showAgentPreviews}
                      dimensions={props.getDimensions(id)}
                      onSelect={handleSelect}
                      onClose={props.onCloseTerminal}
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
                    <div class="py-1.5 px-2.5 text-sm bg-surface-2 border border-edge rounded-2xl shadow-lg">
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
        {/* Sticky footer hint — surfaces the MRU cycle keybind without
         *  needing the user to discover it via the shortcuts help dialog. */}
        <Show when={props.terminalIds.length > 1}>
          <div
            data-testid="sidebar-footer-hint"
            class="shrink-0 px-3 py-2 border-t border-edge text-[0.7rem] text-fg-3 flex items-center gap-1.5"
          >
            <Kbd>{formatKeybind(SHORTCUTS.cycleTerminalMru.keybind)}</Kbd>
            <span>cycle terminals</span>
          </div>
        </Show>
      </aside>
    </>
  );
};

export default Sidebar;
