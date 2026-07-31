/** TerminalContent — a tile's body: one terminal.
 *
 *  Used by CanvasTile (desktop) and MobileTileView (mobile).
 *
 *  There is no in-tile split any more. A terminal with a `parentId` is its own
 *  first-class tile placed beside its parent on the canvas, so a tile holds
 *  exactly one PTY and this component holds exactly one `<Terminal>`. The
 *  resizable sub-panel, its tab bar, the remembered-pane bookkeeping and the
 *  active-pane receding cue all retired with the split. */

import { sleepingArm } from "@kolu/padi/surface";
import type { ITheme } from "@xterm/xterm";
import type { TerminalId } from "kolu-common/surface";
import { type Component, Show } from "solid-js";
import DormantTileBody from "./DormantTileBody";
import Terminal from "./Terminal";
import { useTerminalCrud } from "./useTerminalCrud";
import { useTerminalSearch } from "./useTerminalSearch";
import { useTerminalStore } from "./useTerminalStore";
import { useTileFocus } from "./useTileFocus";

const TerminalContent: Component<{
  terminalId: TerminalId;
  /** Whether this terminal is "active" — controls focus, fit, viewport
   *  publishing. On the canvas: true for all tiles (always rendered);
   *  on mobile: true only for the visible tile. */
  visible: boolean;
  /** Whether this terminal should grab keyboard focus. True only for
   *  the selected tile on the canvas; same as `visible` on mobile. Also
   *  gates the per-terminal find bar (only the focused terminal shows it). */
  focused: boolean;
  theme: ITheme;
  /** Called when a user gesture moves focus into this terminal. */
  onFocus?: () => void;
}> = (props) => {
  const store = useTerminalStore();
  const crud = useTerminalCrud();
  const search = useTerminalSearch();
  const tileFocus = useTileFocus();

  // A sleeping terminal has no live PTY/xterm — render the dormant body instead
  // of the `Terminal` tree. `<Show>` keeps the swap clean: on sleep the live
  // subtree unmounts (xterm dispose, WebGL unload, stream abort via Terminal's
  // onCleanup); on wake it mounts fresh and re-attaches. The discriminant is the
  // single source — no parallel sleeping tile-content kind.
  const isLive = () =>
    sleepingArm(store.getMetadata(props.terminalId)) === undefined;

  return (
    <Show
      when={isLive()}
      fallback={
        <DormantTileBody
          terminalId={props.terminalId}
          onWake={() => void crud.handleWake(props.terminalId)}
          onFocus={props.onFocus}
        />
      }
    >
      <div class="flex-1 min-h-0 overflow-hidden">
        <Terminal
          terminalId={props.terminalId}
          visible={props.visible}
          focused={props.focused}
          theme={props.theme}
          searchOpen={props.focused && search.isOpen(props.terminalId)}
          onSearchOpenChange={(open) => search.setOpen(props.terminalId, open)}
          onFocus={() => {
            tileFocus.focusTerminal(props.terminalId);
            props.onFocus?.();
          }}
          refocusNonce={tileFocus.refocusNonce()}
        />
      </div>
    </Show>
  );
};

export default TerminalContent;
