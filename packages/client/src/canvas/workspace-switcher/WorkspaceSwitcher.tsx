/** WorkspaceSwitcher — floating live-terminal navigator on the canvas.
 *
 *  Owns switcher state and the live model. The collapsed and expanded
 *  presentations are separate renderers so future phases can replace the
 *  compact form without touching search/facet/card behavior.
 *
 *  Engagement model: hover the workspace switcher to open the panel;
 *  any of (mouse leaves, click on pill/card, Escape) dismiss it. Pure
 *  CSS hover doesn't suffice — clicking a button leaves it focused and
 *  `:focus-within` would pin the panel open. So a `dismissed` flag
 *  rides on top of the hover signal: hover opens, explicit actions
 *  close, leaving and re-entering re-arms. The chrome bar fades in a
 *  frosted surface across the whole header during engagement so the
 *  strip and panel read as one floating piece. */

import type { TerminalId } from "kolu-common/surface";
import {
  type Component,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
  Show,
} from "solid-js";
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
  const [hover, setHover] = createSignal(false);
  const [dismissed, setDismissed] = createSignal(false);
  const isOpen = createMemo(() => hover() && !dismissed());
  const switcher = createMemo<WorkspaceSwitcherModel>(() =>
    buildWorkspaceSwitcherModel(props.entries, {
      query: query(),
      repoFilter: repoFilter(),
    }),
  );

  let containerRef: HTMLDivElement | undefined;

  // Document-level cursor tracking. The switcher container itself is
  // `pointer-events-none` so clicks pass through to the canvas — that
  // means `onMouseEnter`/`onMouseLeave` on the container is unreliable.
  // Instead, watch every `mouseover` and check whether the new target
  // sits inside our subtree. Re-entering re-arms the dismiss flag so
  // a second hover after a select reopens the panel naturally.
  onMount(() => {
    const handleOver = (e: MouseEvent) => {
      if (!containerRef) return;
      const inside = containerRef.contains(e.target as Node);
      if (inside !== hover()) {
        setHover(inside);
        if (inside) setDismissed(false);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen()) {
        setDismissed(true);
        e.preventDefault();
      }
    };
    document.addEventListener("mouseover", handleOver);
    document.addEventListener("keydown", handleKey);
    onCleanup(() => {
      document.removeEventListener("mouseover", handleOver);
      document.removeEventListener("keydown", handleKey);
    });
  });

  /** Pick a terminal and dismiss the panel. Selection is the natural
   *  completion of "I'm looking for a terminal" — keep the surface
   *  out of the way once the user has what they came for. */
  const selectAndClose = (id: TerminalId) => {
    setDismissed(true);
    props.onSelect(id);
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
        class="flex flex-nowrap items-start justify-center gap-x-2 transition-opacity duration-150"
        classList={{
          "opacity-100": isOpen(),
          "opacity-80": !isOpen() && !posture.maximized(),
          "opacity-50": !isOpen() && posture.maximized(),
        }}
      >
        <CollapsedWorkspaceSwitcher
          groups={switcher().compactGroups}
          onCreate={props.onCreate}
          onSelect={selectAndClose}
        />
      </div>
      <Show when={isOpen()}>
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
