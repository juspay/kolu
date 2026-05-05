/** WorkspaceSwitcher — floating live-terminal navigator on the canvas.
 *
 *  Owns switcher state and the live model. The collapsed and expanded
 *  presentations are separate renderers so future phases can replace the
 *  compact form without touching search/facet/card behavior.
 *
 *  Engagement model: hovering the workspace switcher reveals a wide
 *  pull-down handle below the strip; clicking the handle opens the
 *  panel and keeps it open until the user clicks outside or presses
 *  Escape. The hover only reveals the affordance — opening is always
 *  an explicit click, so the cursor can roam freely without dismissing
 *  the panel mid-task. */

import type { TerminalId } from "kolu-common/surface";
import {
  type Component,
  createMemo,
  createSignal,
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
} from "./model";
import type { WorkspaceSwitcherSourceEntry } from "./order";

/** Controller that owns query/filter state and composes both switcher views. */
const WorkspaceSwitcher: Component<{
  entries: WorkspaceSwitcherSourceEntry[];
  /** Click handler — caller decides whether to pan, swap active, etc. */
  onSelect: (id: TerminalId) => void;
  /** Open the "new terminal" flow. */
  onCreate: () => void;
}> = (props) => {
  const posture = useViewPosture();
  const [query, setQuery] = createSignal("");
  const [repoFilter, setRepoFilter] = createSignal<string | null>(null);
  const [open, setOpen] = createSignal(false);
  const switcher = createMemo<WorkspaceSwitcherModel>(() =>
    buildWorkspaceSwitcherModel(props.entries, {
      query: query(),
      repoFilter: repoFilter(),
    }),
  );

  let containerRef: HTMLDivElement | undefined;

  // Click-outside / Escape close the panel. Both are scoped to document
  // level so any click that lands outside the switcher container (or
  // any Escape press) collapses the panel — common dropdown ergonomics.
  onMount(() => {
    const handleMouseDown = (e: MouseEvent) => {
      if (!open()) return;
      if (containerRef && !containerRef.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && open()) {
        setOpen(false);
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
    setOpen(false);
  };

  return (
    <div
      ref={containerRef}
      data-testid="workspace-switcher"
      data-maximized={posture.maximized() ? "" : undefined}
      data-open={open() ? "" : undefined}
      class="group/workspace-switcher pointer-events-none select-none w-full relative"
    >
      <div
        class="flex flex-nowrap items-start justify-center gap-x-2 transition-opacity duration-150"
        classList={{
          "opacity-100": open(),
          "opacity-80": !open() && !posture.maximized(),
          "opacity-50": !open() && posture.maximized(),
        }}
      >
        <CollapsedWorkspaceSwitcher
          groups={switcher().compactGroups}
          onCreate={props.onCreate}
          onSelect={selectAndClose}
        />
      </div>
      {/* Pull-down handle — a wide labeled tab that hangs below the
       *  strip. Hidden at rest; on hover/focus of the workspace
       *  switcher the tab fades + slides in, signalling "this whole
       *  area is one control". When open, the tab stays anchored as
       *  the visible toggle. Click toggles the panel; click-outside
       *  and Escape collapse it. */}
      <button
        type="button"
        data-testid="workspace-switcher-toggle"
        class="pointer-events-auto absolute left-1/2 top-full -translate-x-1/2 -mt-px z-[60] flex items-center gap-2 px-4 h-6 rounded-b-lg border border-t-0 border-edge bg-surface-1/95 backdrop-blur-md text-[0.65rem] font-mono uppercase tracking-[0.2em] text-fg-2 hover:text-fg hover:bg-surface-2 active:bg-surface-2 cursor-pointer shadow-[0_4px_12px_-4px_rgba(0,0,0,0.4)] transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
        classList={{
          "opacity-0 -translate-y-1 pointer-events-none group-hover/workspace-switcher:opacity-100 group-hover/workspace-switcher:translate-y-0 group-hover/workspace-switcher:pointer-events-auto group-focus-within/workspace-switcher:opacity-100 group-focus-within/workspace-switcher:translate-y-0 group-focus-within/workspace-switcher:pointer-events-auto":
            !open(),
          "opacity-100 translate-y-0": open(),
        }}
        aria-expanded={open() ? "true" : "false"}
        aria-controls="workspace-switcher-panel"
        aria-label={
          open() ? "Close workspace switcher" : "Open workspace switcher"
        }
        onClick={() => setOpen(!open())}
      >
        <ChevronDownIcon
          class={`w-3 h-3 transition-transform duration-200 ${open() ? "rotate-180" : ""}`}
        />
        <span>{open() ? "hide" : "show all"}</span>
      </button>
      <Show when={open()}>
        <WorkspaceSearchPanel
          model={switcher()}
          query={query()}
          onQueryChange={setQuery}
          onRepoFilterChange={setRepoFilter}
          onSelect={selectAndClose}
        />
      </Show>
    </div>
  );
};

export default WorkspaceSwitcher;
