import type { TerminalId } from "kolu-common/surface";
import { Show, type Component, type JSX } from "solid-js";
import { DockList } from "./canvas/dock/DockList";
import MobileTileView from "./MobileTileView";
import { useTerminalStore } from "./terminal/useTerminalStore";

const CompactTileView: Component<{
  compact: boolean;
  orderedIds: TerminalId[];
  renderBody: (id: TerminalId, visible: () => boolean) => JSX.Element;
  bottomBar?: JSX.Element;
}> = (props) => {
  const store = useTerminalStore();

  return (
    <>
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
