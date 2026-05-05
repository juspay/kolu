/** WorkspaceSwitcher — floating live-terminal navigator on the canvas.
 *
 *  Owns switcher state and the live model. The collapsed and expanded
 *  presentations are separate renderers so future phases can replace the
 *  compact form without touching search/facet/card behavior. */

import type { TerminalId } from "kolu-common/surface";
import { type Component, createMemo, createSignal } from "solid-js";
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
  const switcher = createMemo<WorkspaceSwitcherModel>(() =>
    buildWorkspaceSwitcherModel(props.entries, {
      query: query(),
      repoFilter: repoFilter(),
    }),
  );

  return (
    <div
      data-testid="workspace-switcher"
      data-maximized={posture.maximized() ? "" : undefined}
      class="group/workspace-switcher pointer-events-none select-none w-full relative"
    >
      <div
        class="flex flex-nowrap items-start justify-center gap-x-2 transition-opacity duration-150 group-hover/workspace-switcher:opacity-100 group-focus-within/workspace-switcher:opacity-100"
        classList={{
          "opacity-80": !posture.maximized(),
          "opacity-50": posture.maximized(),
        }}
      >
        <CollapsedWorkspaceSwitcher
          groups={switcher().compactGroups}
          onCreate={props.onCreate}
          onSelect={props.onSelect}
        />
        <WorkspaceSearchPanel
          model={switcher()}
          query={query()}
          onQueryChange={setQuery}
          onRepoFilterChange={setRepoFilter}
          onSelect={props.onSelect}
        />
      </div>
    </div>
  );
};

export default WorkspaceSwitcher;
