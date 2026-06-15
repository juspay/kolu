/** MobileDockDrawer — left-edge swipe drawer carrying the dock
 *  terminal list on the phone layout.
 *
 *  Phone mirror of the desktop dock (#903): the dock is the canonical
 *  live-terminal navigator, so on a phone it gets the standard iOS /
 *  Android "navigation drawer" gesture — swipe from the left edge, or
 *  tap the thin left-edge handle, to reveal the terminal list.
 *
 *  The list itself is `DockList` (shared with the compact layout's
 *  persistent rail). The drawer's one addition is its selection
 *  semantics: picking a row also dismisses the sheet. */

import type { TerminalId } from "kolu-common/surface";
import type { Component } from "solid-js";
import { DockList } from "./DockList";

const MobileDockDrawer: Component<{
  onSelect: (id: TerminalId) => void;
  onClose: () => void;
}> = (props) => {
  function handleSelect(id: TerminalId) {
    props.onSelect(id);
    props.onClose();
  }

  return (
    <div data-testid="mobile-dock-sheet" class="flex flex-col h-full">
      <DockList onSelect={handleSelect} />
    </div>
  );
};

export default MobileDockDrawer;
