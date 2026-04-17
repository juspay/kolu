/** Dock — thin dispatcher. Reads `currentLayout()` and `dockVisible()` from
 *  the `useLayout` seam; renders `CompactDock` when compact. The canvas
 *  rendering (`CanvasDock`) is rendered inside `TerminalCanvas` where it
 *  can see tile layouts directly, not here — the canvas minimap belongs
 *  inside the canvas view conceptually (it overlays the canvas, depends
 *  on canvas viewport state, and has zero meaning when canvas isn't
 *  mounted). `TerminalCanvas` wraps it in its own `<Show when={dockVisible()}>`.
 *
 *  The pre-split shape (CanvasDock + CompactDock separate files sharing
 *  primitives in `dock/`) follows hickey/lowy structural review: the two
 *  renderings share ~0% state/gestures, and bundling them into one file
 *  with a `currentLayout()` branch would be functional decomposition
 *  disguised as a single component. */

import { type Component, Show } from "solid-js";
import { currentLayout, dockVisible } from "../layout/useLayout";
import CompactDock from "./CompactDock";
import type { TerminalDisplayInfo } from "../terminal/terminalDisplay";
import type { TerminalId, TerminalMetadata } from "kolu-common";
import type { ITheme } from "@xterm/xterm";

const Dock: Component<{
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
}> = (props) => (
  <Show when={currentLayout() === "compact" && dockVisible()}>
    <CompactDock
      terminalIds={props.terminalIds}
      activeId={props.activeId}
      getMetadata={props.getMetadata}
      isUnread={props.isUnread}
      getDisplayInfo={props.getDisplayInfo}
      getTerminalTheme={props.getTerminalTheme}
      onSelect={props.onSelect}
      onCloseTerminal={props.onCloseTerminal}
      onCreate={props.onCreate}
      onNewTerminalMenu={props.onNewTerminalMenu}
      onReorder={props.onReorder}
    />
  </Show>
);

export default Dock;
