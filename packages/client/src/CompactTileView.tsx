/** CompactTileView — the two-pane layout for roomy touch screens.
 *
 *  Where the phone collapses to a single fullscreen tile (`MobileTileView`) and
 *  the desktop spreads tiles across a pan/zoom canvas, a finger-driven device
 *  that is *wide* — a Z Fold 6 unfolded (~900 CSS px, near-square), an iPad, an
 *  Android tablet — wants neither: the phone layout wastes the width, and the
 *  canvas + floating Dock are mouse affordances. So compact pairs a *persistent*
 *  dock rail (the terminal navigator, always visible — no swipe-to-reveal) with
 *  the active terminal filling the rest.
 *
 *  It deliberately reuses `MobileTileView` for the terminal pane: the top chrome
 *  sheet, swipe-to-cycle, the soft-keyboard key bar, and per-terminal body
 *  rendering are identical to the phone. The only differences are this rail and
 *  `hideDockDrawer`, which drops MobileTileView's redundant left-edge dock
 *  drawer (the rail is the persistent navigator instead).
 *
 *  Hosted, like the phone, inside `RightPanelDrawer` — the Code/diff/comments
 *  panel reveals as a bottom sheet (the touch-layout host), not the desktop
 *  Resizable split. */

import type { TerminalId } from "kolu-common/surface";
import type { Component, JSX } from "solid-js";
import { DockList } from "./canvas/dock/DockList";
import MobileTileView from "./MobileTileView";
import type { WsStatus } from "./rpc/rpc";
import { useTerminalStore } from "./terminal/useTerminalStore";

const CompactTileView: Component<{
  /** Workspace-switcher-ordered ids — passed through to the terminal pane for
   *  swipe-to-cycle (the rail reads the same `useDockOrder` order itself). */
  orderedIds: TerminalId[];
  status: WsStatus;
  appTitle: string;
  onOpenPalette: () => void;
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
        class="shrink-0 w-52 min-h-0 flex flex-col border-r border-edge bg-surface-1"
      >
        <DockList onSelect={store.setActiveSilently} />
      </aside>
      <MobileTileView
        orderedIds={props.orderedIds}
        status={props.status}
        appTitle={props.appTitle}
        onOpenPalette={props.onOpenPalette}
        renderBody={props.renderBody}
        bottomBar={props.bottomBar}
        hideDockDrawer
      />
    </>
  );
};

export default CompactTileView;
