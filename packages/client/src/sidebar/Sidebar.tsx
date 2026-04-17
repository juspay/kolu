import {
  type Component,
  For,
  Show,
  createEffect,
  createSignal,
} from "solid-js";
import { isTouch } from "../useMobile";
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
import { match } from "ts-pattern";
import Tip from "../ui/Tip";
import Kbd from "../ui/Kbd";
import TerminalMeta from "../terminal/TerminalMeta";
import TerminalPreview from "../terminal/TerminalPreview";
import { usePreferences } from "../settings/usePreferences";
import { useTips } from "../settings/useTips";
import { sidebarSwitchTip } from "../settings/tips";
import { formatKeybind, SHORTCUTS } from "../input/keyboard";
import type { TerminalDisplayInfo } from "../terminal/terminalDisplay";
import type {
  AgentInfo,
  SidebarAgentPreviews,
  TerminalId,
  TerminalMetadata,
} from "kolu-common";
import type { ITheme } from "@xterm/xterm";
import { viewportDimensions } from "../useViewport";

type CardTier = "waiting" | "active" | "idle";

/** Derive the visual tier for the sidebar card from live agent state.
 *  Generic — works for any agent kind without reading `.state` or `.kind`.
 *  Note: `unread` (unseen completion) is orthogonal — rendered as a
 *  separate dot, not folded into this tier. */
function cardTier(agent: AgentInfo | undefined): CardTier {
  if (!agent) return "idle";
  return match(agent)
    .with({ state: "waiting" }, () => "waiting" as const)
    .otherwise(() => "active" as const);
}

/** Decide whether a sidebar card should render a live xterm preview.
 *
 *  User-configurable via the `sidebarAgentPreviews` preference:
 *
 *  - `"none"`: never — the user opted out entirely.
 *  - `"all"`: every terminal gets a preview, agent or not. Noisy, but
 *    handy for testing the preview plumbing itself.
 *  - `"agents"`: any terminal with a running code agent. This was the
 *    behavior before the enum was introduced (legacy `true`).
 *  - `"attention"` (**default**): only agents with an **unread**
 *    completion — Claude finished and the user hasn't seen it yet.
 *    Previews are expensive vertically (only ~3 cards fit — see #388),
 *    so we reserve them for the moment peeking without switching
 *    actually helps. Once the user looks, the preview disappears and
 *    frees the sidebar slot. */
function shouldShowPreview(
  mode: SidebarAgentPreviews,
  hasAgent: boolean,
  unread: boolean,
): boolean {
  return match(mode)
    .with("none", () => false)
    .with("all", () => true)
    .with("agents", () => hasAgent)
    .with("attention", () => hasAgent && unread)
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
  onSelect: (id: TerminalId) => void;
  onClose: (id: TerminalId) => void;
  dropEdge: "above" | "below" | null;
}> = (props) => {
  /** Agent terminals get a live preview below the meta — lets the user
   *  watch what their agents are saying without switching terminals.
   *  Non-agent terminals and "ambient" agent states keep the compact
   *  meta-only card to save vertical space (see {@link shouldShowPreview}
   *  for the gating rationale). The preview waits until the viewport has
   *  been measured at least once so the preview xterm can size itself to
   *  match the main terminal exactly. Returns the current viewport dims
   *  when the card should render, otherwise `undefined` — lets the JSX
   *  `Show` narrow the type in the rendered branch. */
  const { preferences } = usePreferences();
  const showPreview = () => {
    const vp = viewportDimensions();
    if (!vp) return undefined;
    return shouldShowPreview(
      preferences().sidebarAgentPreviews,
      props.metadata?.agent != null,
      props.unread,
    )
      ? vp
      : undefined;
  };
  const sortable = createSortable(props.id);
  const tier = () => cardTier(props.displayInfo?.meta.agent ?? undefined);
  /** On touch devices, drag-anywhere conflicts with vertical scrolling
   *  (every swipe becomes a drag candidate via `touch-action: none`).
   *  When coarse, drag activation moves to a small grip handle inside
   *  the card and the button switches to `touch-action: pan-y` so the
   *  list scrolls. Desktop keeps the drag-anywhere behavior unchanged. */
  const isCoarse = isTouch;

  /** When this entry becomes active, scroll itself into view. Handles both
   *  switching to an existing terminal AND creating a new one: in either
   *  case, the effect runs on the element that already has `buttonRef`
   *  bound, so there's no race with DOM mount order (unlike a parent-level
   *  effect that would have to querySelector by id). `block: "nearest"` is
   *  a no-op when the card is already visible. */
  let buttonRef!: HTMLButtonElement;
  createEffect(() => {
    if (props.isActive) {
      buttonRef.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  });

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
          ref={(el) => {
            sortable.ref(el);
            buttonRef = el;
          }}
          // Drag activators only on the button when NOT coarse — desktop
          // keeps drag-anywhere; on coarse, the grip span below owns
          // activation so the button surface stays scroll-friendly.
          {...(isCoarse() ? {} : sortable.dragActivators)}
          data-terminal-id={props.id}
          data-active={props.isActive ? "" : undefined}
          data-activity={
            props.displayInfo?.activityHistory.at(-1)?.[1]
              ? "active"
              : "sleeping"
          }
          data-unread={props.unread ? "" : undefined}
          class="group relative w-full text-sm text-left transition-all duration-200"
          classList={{
            // touch-pan-y on coarse lets vertical scroll pass through;
            // touch-none on non-coarse preserves the existing desktop
            // drag-anywhere activation surface.
            "touch-pan-y": isCoarse(),
            "touch-none": !isCoarse(),
            "rounded-[14px]": !props.isActive,
            "rounded-l-[14px] rounded-r-none": props.isActive,
            "text-fg": props.isActive || tier() !== "idle",
            "text-fg-3 hover:text-fg-2": !props.isActive && tier() === "idle",
            "opacity-25": sortable.isActiveDraggable,
          }}
          style={{
            /* Active card uses the actual xterm theme bg — same material as the terminal.
             * --active-terminal-bg is published by App.tsx on the layout root.
             *
             * Inactive cards get a light mix of THIS terminal's theme bg into
             * surface-1 so the sidebar at rest looks variegated — each card
             * hints at its own terminal's colour instead of every card being
             * the same surface-1 grey.
             *
             * Active card also scope-overrides the fg tier vars so every
             * `text-fg-*` descendant re-tunes to the terminal theme's own
             * foreground instead of the global one. color-mix against the
             * active bg derives fg-2/fg-3 tiers that are guaranteed to
             * stay readable regardless of whether the terminal theme is
             * light or dark. Fixes #390. */
            "background-color": props.isActive
              ? "var(--active-terminal-bg)"
              : props.terminalTheme.background
                ? `color-mix(in oklch, ${props.terminalTheme.background} 8%, var(--color-surface-1))`
                : "var(--color-surface-1)",
            ...(props.isActive
              ? {
                  "--color-fg": "var(--active-terminal-fg)",
                  "--color-fg-2":
                    "color-mix(in oklch, var(--active-terminal-fg) 75%, var(--active-terminal-bg))",
                  "--color-fg-3":
                    "color-mix(in oklch, var(--active-terminal-fg) 55%, var(--active-terminal-bg))",
                }
              : {}),
          }}
          onClick={() => props.onSelect(props.id)}
          onMouseDown={(e) => e.preventDefault()}
          title={props.metadata?.cwd ?? String(props.id)}
        >
          <div class="min-w-0 px-2.5 py-2 pr-6">
            <TerminalMeta info={props.displayInfo} />
          </div>
          <Show when={showPreview()}>
            {(vp) => (
              <div
                data-testid="sidebar-preview"
                class="mx-2.5 mb-2 h-40 rounded-lg overflow-hidden border border-edge bg-surface-0"
              >
                <TerminalPreview
                  terminalId={props.id}
                  theme={props.terminalTheme}
                  cols={vp().cols}
                  rows={vp().rows}
                />
              </div>
            )}
          </Show>

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
          {/* Drag handle — only on coarse-pointer devices. Owns drag
           *  activation so the rest of the card surface can stay
           *  scrollable (touch-pan-y). touch-none on the handle itself
           *  ensures the browser hands the gesture to dnd-kit. */}
          <Show when={isCoarse()}>
            <span
              {...sortable.dragActivators}
              data-testid="sidebar-drag-handle"
              // stopPropagation: a tap on the grip is a drag affordance,
              // not a terminal selector — don't bubble to the button's
              // onClick (which would switch terminals on every grab).
              onClick={(e) => e.stopPropagation()}
              class="absolute bottom-1 right-1 flex items-center justify-center w-7 h-7 text-fg-3 touch-none cursor-grab"
              aria-label="Drag to reorder"
              title="Drag to reorder"
            >
              <svg
                class="w-4 h-4"
                viewBox="0 0 16 16"
                fill="currentColor"
                aria-hidden="true"
              >
                <circle cx="5" cy="4" r="1.2" />
                <circle cx="5" cy="8" r="1.2" />
                <circle cx="5" cy="12" r="1.2" />
                <circle cx="11" cy="4" r="1.2" />
                <circle cx="11" cy="8" r="1.2" />
                <circle cx="11" cy="12" r="1.2" />
              </svg>
            </span>
          </Show>
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
