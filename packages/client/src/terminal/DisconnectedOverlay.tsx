/** Overlay covering a remote terminal's tile while the underlying
 *  `HostSession` isn't `connected`. Backed by `meta.connectionState`
 *  (the server pushes transitions from `@kolu/surface-nix-host`'s
 *  `session.onState` into the live half of TerminalMetadata).
 *
 *  States the overlay reacts to:
 *
 *    - `copying`      — first-spawn nix copy + remote realise. Cold
 *                       case takes ~30s; the overlay holds the tile
 *                       so the user sees progress instead of an empty
 *                       black square.
 *    - `connecting`   — drv copied, agent process spinning up.
 *    - `disconnected` — ssh dropped (network, agent crash, host
 *                       restart). The host session retries
 *                       automatically; the overlay covers the gap.
 *    - `connected`    — overlay disappears (its render is gated on
 *                       inequality).
 *
 *  Local terminals don't carry `connectionState` (undefined →
 *  treated as connected → overlay invisible). */

import type { TerminalConnectionState } from "kolu-common/surface";
import { type Component, Show } from "solid-js";

const LABEL: Record<TerminalConnectionState, string> = {
  copying: "Copying agent to remote…",
  connecting: "Connecting…",
  connected: "Connected",
  disconnected: "Disconnected — reconnecting…",
};

const HINT: Record<TerminalConnectionState, string> = {
  copying: "First spawn on this host can take ~30s (nix copy + realise)",
  connecting: "Agent process is starting on the remote",
  connected: "",
  disconnected: "The ssh+stdio link dropped; HostSession will retry",
};

const DisconnectedOverlay: Component<{
  state: TerminalConnectionState | undefined;
}> = (props) => {
  const visible = () =>
    props.state !== undefined && props.state !== "connected";
  return (
    <Show when={visible()}>
      {/* Pointer-events-none so users can still scroll/click the
       *  underlying xterm if they want to interact with whatever
       *  buffered state is there. The overlay is informational, not
       *  a modal. */}
      <div
        class="absolute inset-0 pointer-events-none flex items-center justify-center bg-bg/70 backdrop-blur-sm z-10"
        data-testid="disconnected-overlay"
        data-state={props.state}
      >
        <div class="flex flex-col items-center gap-1 text-center">
          <div class="text-sm font-medium text-fg">
            <Show when={props.state}>{(s) => LABEL[s()]}</Show>
          </div>
          <div class="text-xs text-fg-3">
            <Show when={props.state}>{(s) => HINT[s()]}</Show>
          </div>
        </div>
      </div>
    </Show>
  );
};

export default DisconnectedOverlay;
