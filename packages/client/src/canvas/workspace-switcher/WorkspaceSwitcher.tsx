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
  /** Active terminal id — kept in the collapsed pill strip even if its
   *  repo's idle cap would otherwise hide it. */
  activeId: TerminalId | null;
  /** Per-terminal recency accessor; threads into the model so it can apply
   *  the canonical sort internally (no caller-side pre-sorting). */
  getRecency: (id: TerminalId) => number;
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
      activeId: props.activeId,
      getRecency: props.getRecency,
    }),
  );

  let containerRef: HTMLDivElement | undefined;
  const beginHover = () => {
    setHover(true);
    setDismissed(false);
  };

  const endHover = () => {
    setHover(false);
  };

  /** Close everything — clear the latch and dismiss the hover-driven open. */
  const closePanel = () => {
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
    setHover(false);
    setLatched(true);
    setDismissed(false);
    setFocusSearchOnOpen(true);
  };

  createEffect(on(() => props.openRequest, openFromShortcut, { defer: true }));

  // `mousedown` outside the subtree closes a latched panel — without this,
  // latching would have no escape via clicking on the canvas. Hover is
  // intentionally handled on the visible strip/panel instead of a document
  // `mouseover`: keep any transparent hit area narrow and local to the
  // row/panel crossing so it cannot become a broad click deadzone.
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
      onPointerEnter={beginHover}
      onPointerLeave={endHover}
    >
      <div class="pointer-events-none mx-auto relative w-fit max-w-full">
        <div
          class="pointer-events-auto mx-auto flex w-fit max-w-full flex-nowrap items-start justify-center gap-x-2 transition-opacity duration-150"
          classList={{
            "opacity-100": isOpen(),
            "opacity-80": !isOpen(),
          }}
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
              latched()
                ? "Close workspace switcher"
                : "Pin workspace switcher open"
            }
            // Chevron rotation tracks `isOpen()` so the visual matches the
            // panel's visibility. The click action gates on `latched()` —
            // clicking a hover-opened panel pins it; clicking a latched
            // panel closes it. Title describes the action, not the state.
            title={latched() ? "Close workspaces" : "Pin workspaces open"}
            onClick={toggleLatch}
          >
            <span
              class="inline-flex transition-transform duration-200"
              classList={{ "rotate-180": isOpen() }}
            >
              <ChevronDownIcon class="w-3.5 h-3.5" />
            </span>
          </button>
        </div>
        <Show when={isOpen()}>
          <div
            aria-hidden="true"
            class="pointer-events-auto absolute inset-x-0 top-10 h-4"
          />
        </Show>
      </div>
      <Show when={isOpen()}>
        <div class="pointer-events-none absolute inset-x-0 top-11 z-50 mx-auto w-full max-w-[78rem] pt-2">
          <WorkspaceSearchPanel
            model={switcher()}
            query={query()}
            focusSearch={focusSearchOnOpen()}
            onQueryChange={setQuery}
            onSearchFocused={() => setFocusSearchOnOpen(false)}
            onRepoFilterChange={setRepoFilter}
            onSelect={selectAndClose}
            onClose={closePanel}
          />
        </div>
      </Show>
    </div>
  );
};

export default WorkspaceSwitcher;
