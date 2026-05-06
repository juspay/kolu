/** WorkspaceSwitcher — floating live-terminal navigator on the canvas.
 *
 *  Owns switcher state and the live model. The collapsed and expanded
 *  presentations are separate renderers so future phases can replace the
 *  compact form without touching search/facet/card behavior.
 *
 *  Engagement model: two ways to open the panel —
 *
 *    1. Hover the workspace switcher; cursor leaving auto-closes.
 *    2. Click the toggle button; the panel "latches" open until an
 *       explicit dismissal (close button, Esc, click outside, select).
 *
 *  Latching exists because hover-only is fragile: once a button inside
 *  the panel takes focus, the user wants stability while they search,
 *  click facets, etc. Click-to-open says "stay until I dismiss."
 *
 *  The chrome bar fades in a frosted surface across the whole header
 *  during engagement so the strip and panel read as one floating piece. */

import type { TerminalId } from "kolu-common/surface";
import {
  type Component,
  createEffect,
  createMemo,
  createSignal,
  on,
  onCleanup,
  onMount,
  Show,
} from "solid-js";
import { ChevronDownIcon } from "../../ui/Icons";
import { useViewPosture } from "../useViewPosture";
import CollapsedWorkspaceSwitcher from "./Collapsed";
import WorkspaceSearchPanel from "./SearchPanel";
import {
  buildWorkspaceSwitcherModel,
  type WorkspaceSwitcherModel,
  type WorkspaceSwitcherSourceEntry,
} from "./model";

/** Controller that owns query/filter state and composes both switcher views. */
const WorkspaceSwitcher: Component<{
  entries: WorkspaceSwitcherSourceEntry[];
  /** Incremented by the app-level shortcut to latch the panel open. */
  openRequest: number;
  /** Click handler — caller decides whether to pan, swap active, etc. */
  onSelect: (id: TerminalId) => void;
  /** Open the "new terminal" flow. */
  onCreate: () => void;
}> = (props) => {
  const posture = useViewPosture();
  const [query, setQuery] = createSignal("");
  const [repoFilter, setRepoFilter] = createSignal<string | null>(null);
  const [hover, setHover] = createSignal(false);
  const [dismissed, setDismissed] = createSignal(false);
  const [latched, setLatched] = createSignal(false);
  const [focusSearchOnOpen, setFocusSearchOnOpen] = createSignal(false);
  const isOpen = createMemo(() => latched() || (hover() && !dismissed()));
  const switcher = createMemo<WorkspaceSwitcherModel>(() =>
    buildWorkspaceSwitcherModel(props.entries, {
      query: query(),
      repoFilter: repoFilter(),
    }),
  );

  let containerRef: HTMLDivElement | undefined;
  let hoverCloseTimer: number | undefined;

  const clearHoverCloseTimer = () => {
    if (hoverCloseTimer === undefined) return;
    window.clearTimeout(hoverCloseTimer);
    hoverCloseTimer = undefined;
  };

  const beginHover = () => {
    clearHoverCloseTimer();
    setHover(true);
    setDismissed(false);
  };

  const endHoverSoon = () => {
    clearHoverCloseTimer();
    hoverCloseTimer = window.setTimeout(() => {
      setHover(false);
      hoverCloseTimer = undefined;
    }, 140);
  };

  /** Close everything — clear the latch and dismiss the hover-driven open. */
  const closePanel = () => {
    clearHoverCloseTimer();
    setHover(false);
    setLatched(false);
    setDismissed(true);
    setFocusSearchOnOpen(false);
  };

  /** Toggle the latch from the explicit toggle button. Gates on
   *  `latched()`, not `isOpen()`: a hover-opened panel + click should
   *  *latch* it (so the cursor can roam without dismissing), not
   *  flip-close. Second click on the latched chevron un-latches. */
  const toggleLatch = () => {
    if (latched()) {
      closePanel();
    } else {
      setLatched(true);
      setDismissed(false);
    }
  };

  const openFromShortcut = () => {
    clearHoverCloseTimer();
    setHover(false);
    setLatched(true);
    setDismissed(false);
    setFocusSearchOnOpen(true);
  };

  createEffect(on(() => props.openRequest, openFromShortcut, { defer: true }));

  // `mousedown` outside the subtree closes a latched panel — without this,
  // latching would have no escape via clicking on the canvas. Hover is
  // intentionally handled on the visible strip/panel instead of a document
  // `mouseover`: transparent pointer-event bridges are easy to put above
  // the pill buttons and turn their edges into click deadzones.
  onMount(() => {
    const handleMouseDown = (e: MouseEvent) => {
      if (!latched() || !containerRef) return;
      if (!containerRef.contains(e.target as Node)) closePanel();
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen()) {
        closePanel();
        e.preventDefault();
      }
    };
    document.addEventListener("mousedown", handleMouseDown);
    document.addEventListener("keydown", handleKey);
    onCleanup(() => {
      clearHoverCloseTimer();
      document.removeEventListener("mousedown", handleMouseDown);
      document.removeEventListener("keydown", handleKey);
    });
  });

  /** Pick a terminal and dismiss the panel. Selection is the natural
   *  completion of "I'm looking for a terminal" — keep the surface
   *  out of the way once the user has what they came for. */
  const selectAndClose = (id: TerminalId) => {
    props.onSelect(id);
    closePanel();
  };

  return (
    <div
      ref={containerRef}
      data-testid="workspace-switcher"
      data-maximized={posture.maximized() ? "" : undefined}
      data-open={isOpen() ? "" : undefined}
      class="pointer-events-none select-none w-full relative"
    >
      <div
        class="pointer-events-auto mx-auto flex w-fit max-w-full flex-nowrap items-start justify-center gap-x-2 transition-opacity duration-150"
        classList={{
          "opacity-100": isOpen(),
          "opacity-80": !isOpen(),
        }}
        onPointerEnter={beginHover}
        onPointerLeave={endHoverSoon}
      >
        <CollapsedWorkspaceSwitcher
          groups={switcher().compactGroups}
          onCreate={props.onCreate}
          onSelect={selectAndClose}
        />
        {/* Explicit toggle — clicking opens the panel and latches it open
         *  until an explicit dismissal. Mirrors the new-terminal "+" on
         *  the strip's left edge so the row reads as a pair of tools. */}
        <button
          type="button"
          data-testid="workspace-switcher-toggle"
          class="pointer-events-auto flex items-center justify-center w-7 h-7 mt-3 rounded-md shrink-0 cursor-pointer text-fg-3 hover:text-fg hover:bg-surface-2/70 active:bg-surface-2 transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
          aria-expanded={isOpen() ? "true" : "false"}
          aria-controls="workspace-switcher-panel"
          aria-label={
            latched() ? "Close workspace switcher" : "Open workspace switcher"
          }
          title={latched() ? "Close workspaces" : "Show all workspaces"}
          onClick={toggleLatch}
        >
          <ChevronDownIcon
            class={`w-3.5 h-3.5 transition-transform duration-200 ${latched() ? "rotate-180" : ""}`}
          />
        </button>
      </div>
      <Show when={isOpen()}>
        <WorkspaceSearchPanel
          model={switcher()}
          query={query()}
          focusSearch={focusSearchOnOpen()}
          onQueryChange={setQuery}
          onSearchFocused={() => setFocusSearchOnOpen(false)}
          onRepoFilterChange={setRepoFilter}
          onSelect={selectAndClose}
          onClose={closePanel}
          onPointerEnter={beginHover}
          onPointerLeave={endHoverSoon}
        />
      </Show>
    </div>
  );
};

export default WorkspaceSwitcher;
