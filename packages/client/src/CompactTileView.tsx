/** The retained touch workspace. Phone and compact share MobileTileView;
 *  compact adds a dock rail, while phone exposes the drawer. Both live inside
 *  RightPanelDrawer, so folding changes chrome without replacing terminals. */

import type { TerminalId } from "kolu-common/surface";
import { Show, type Component, type JSX } from "solid-js";
import { DockList } from "./canvas/dock/DockList";
import MobileTileView from "./MobileTileView";
import { useTerminalStore } from "./terminal/useTerminalStore";

const CompactTileView: Component<{
  compact: boolean;
  /** The same dock-filtered ids the workspace terminal owner renders. */
  orderedIds: TerminalId[];
  renderBody: (id: TerminalId, visible: () => boolean) => JSX.Element;
  bottomBar?: JSX.Element;
}> = (props) => {
  const store = useTerminalStore();

  return (
    <>
      {/* Persistent dock rail — the always-visible terminal navigator. Kept
       *  deliberately narrow: a roomy touch device (Z Fold 6 unfolded) wants its
       *  width spent on the terminal, so the rail takes the minimum that keeps a
       *  row's agent pip + a useful slice of its branch/intent label legible and
       *  the terminal pane (`flex-1` inside MobileTileView) takes the rest.
       *  `shrink-0` keeps the rail from collapsing under a busy tile. */}
      <aside
        data-testid="compact-dock-rail"
        classList={{ hidden: !props.compact }}
        inert={!props.compact}
        class="shrink-0 w-52 min-h-0 flex flex-col border-r border-edge bg-surface-1"
      >
        <Show when={props.compact}>
          <DockList onSelect={store.focusTerminalSilently} />
        </Show>
      </aside>
      <MobileTileView
        orderedIds={props.orderedIds}
        renderBody={props.renderBody}
        bottomBar={props.bottomBar}
        hideDockDrawer={props.compact}
      />
    </>
  );
};

export default CompactTileView;
